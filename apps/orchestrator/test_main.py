import unittest

from main import (
    backend_result_ids_for_run,
    build_explanation_messages,
    decode_backend_result_ids,
    extract_llm_explanation,
    fetch_merged_backend_results,
    merge_metric_results,
    metric_result_index,
    normalize_assessed_target,
    resolve_llm_chat_completions_url,
    split_file_metrics,
)


class AssessedTargetTests(unittest.TestCase):
    def test_full_url_is_reduced_to_page_path(self):
        self.assertEqual(
            normalize_assessed_target('http://localhost:3000/projects?tab=active#top'),
            '/projects'
        )

    def test_origin_and_trailing_slash_are_canonicalized(self):
        self.assertEqual(normalize_assessed_target('https://example.com/'), '/')
        self.assertEqual(normalize_assessed_target('https://example.com/projects/'), '/projects')

    def test_non_url_artifact_name_is_preserved(self):
        self.assertEqual(normalize_assessed_target('capture.png'), 'capture.png')

    def test_existing_path_discards_query_and_fragment(self):
        self.assertEqual(normalize_assessed_target('/projects/?tab=active#top'), '/projects')


class MetricResultIndexTests(unittest.TestCase):
    def test_prefers_non_empty_duplicate_result(self):
        indexed = metric_result_index([
            {'metric_id': 'm1_png_file_size', 'results': []},
            {'metric_id': 'm1_png_file_size', 'results': [42]},
        ])
        self.assertEqual(indexed['m1_png_file_size']['results'], [42])


class FileMetricRoutingTests(unittest.TestCase):
    def test_decodes_jsonb_backend_ids_returned_by_asyncpg(self):
        self.assertEqual(
            decode_backend_result_ids('["png-id", "html-id"]'),
            ['png-id', 'html-id']
        )

    def test_history_uses_every_backend_job_for_split_artifacts(self):
        self.assertEqual(
            backend_result_ids_for_run({
                'backendResultId': 'png-id',
                'backendResultIds': '["png-id", "html-id"]',
            }),
            ['png-id', 'html-id']
        )

    def test_history_falls_back_to_legacy_single_backend_job(self):
        self.assertEqual(
            backend_result_ids_for_run({
                'backendResultId': 'legacy-id',
                'backendResultIds': None,
            }),
            ['legacy-id']
        )

    def test_routes_word_count_to_html_and_keeps_visual_metrics_on_png(self):
        png_metrics, html_metrics = split_file_metrics([
            'm1', 'm8', 'm9_edge_density'
        ])

        self.assertEqual(png_metrics, ['m1', 'm9_edge_density'])
        self.assertEqual(html_metrics, ['m8'])

    def test_merges_results_from_png_and_html_evaluations(self):
        merged = merge_metric_results(
            [{'metric_id': 'm1_png_file_size', 'results': [123]}],
            [{'metric_id': 'm8_word_count', 'results': [17]}],
        )

        self.assertEqual(merged, [
            {'metric_id': 'm1_png_file_size', 'results': [123]},
            {'metric_id': 'm8_word_count', 'results': [17]},
        ])


class HistoryBackendResultTests(unittest.IsolatedAsyncioTestCase):
    async def test_fetches_and_merges_png_and_html_history_results(self):
        result_sets = {
            'png-id': [{'metric_id': 'm1_png_file_size', 'results': [123]}],
            'html-id': [{'metric_id': 'm8_word_count', 'results': [17]}],
        }

        class Response:
            def __init__(self, results):
                self.results = results

            def raise_for_status(self):
                return None

            def json(self):
                return self.results

        class Client:
            async def get(self, url):
                return Response(result_sets[url.rsplit('/', 1)[-1]])

        merged = await fetch_merged_backend_results(Client(), ['png-id', 'html-id'])

        self.assertEqual(merged, [
            {'metric_id': 'm1_png_file_size', 'results': [123]},
            {'metric_id': 'm8_word_count', 'results': [17]},
        ])


class LlmExplanationTests(unittest.TestCase):
    def test_resolves_provider_base_and_full_chat_urls(self):
        self.assertEqual(
            resolve_llm_chat_completions_url('https://provider.example/v1'),
            'https://provider.example/v1/chat/completions'
        )
        self.assertEqual(
            resolve_llm_chat_completions_url('https://provider.example'),
            'https://provider.example/v1/chat/completions'
        )
        self.assertEqual(
            resolve_llm_chat_completions_url('https://provider.example/v1/chat/completions'),
            'https://provider.example/v1/chat/completions'
        )

    def test_prompt_contains_current_history_and_plain_language_guidance(self):
        messages = build_explanation_messages(
            [{'metric_id': 'm9_edge_density', 'results': [0.24]}],
            {'metrics': {
                'm9_edge_density': {'results': [0.18], 'createdAt': '2026-01-01T12:00:00Z'}
            }},
        )

        self.assertIn('non-technical reader', messages[0]['content'])
        self.assertIn('Edge density', messages[1]['content'])
        self.assertIn('0.24', messages[1]['content'])
        self.assertIn('0.18', messages[1]['content'])

    def test_artifact_urls_are_not_sent_to_llm(self):
        messages = build_explanation_messages(
            [{'metric_id': 'm7_saliency', 'results': ['https://private.example/map.png']}],
            None,
        )

        self.assertNotIn('private.example', messages[1]['content'])
        self.assertIn('[artifact URL omitted]', messages[1]['content'])

    def test_extracts_openai_compatible_message_content(self):
        self.assertEqual(
            extract_llm_explanation({
                'choices': [{'message': {'content': '  The page became less cluttered.  '}}]
            }),
            'The page became less cluttered.'
        )


if __name__ == '__main__':
    unittest.main()
