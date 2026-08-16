import unittest
from datetime import datetime, timezone
from fastapi import HTTPException
from unittest.mock import AsyncMock, patch

import httpx

from main import (
    assessment_run_summary,
    backend_result_ids_for_run,
    build_explanation_messages,
    decode_backend_result_ids,
    extract_llm_explanation,
    fetch_merged_backend_results,
    merge_metric_results,
    metric_result_index,
    normalize_assessed_target,
    normalize_repo_url,
    resolve_llm_chat_completions_url,
    select_comparison_findings,
    split_file_metrics,
    get_eval_result,
    get_eval_result_history,
)


class AssessmentRunSummaryTests(unittest.TestCase):
    def test_exposes_commit_dirty_state_target_and_dimensions(self):
        created_at = datetime(2026, 8, 11, 12, 30, tzinfo=timezone.utc)
        summary = assessment_run_summary({
            'id': 17,
            'createdAt': created_at,
            'commitHash': 'abcdef1234567890',
            'gitDirty': True,
            'branch': 'main',
            'assessedTarget': '/dashboard',
            'screenshotWidth': 1440,
            'screenshotHeight': 900,
            'assessment': {
                'mode': 'profiles',
                'profiles': [{'id': 'visual-complexity', 'direction': 'decrease'}],
            },
        })

        self.assertEqual(summary, {
            'id': 17,
            'createdAt': created_at.isoformat(),
            'commitHash': 'abcdef1234567890',
            'gitDirty': True,
            'branch': 'main',
            'assessedTarget': '/dashboard',
            'screenshotDimensions': {'width': 1440, 'height': 900},
            'assessment': {
                'mode': 'profiles',
                'profiles': [{'id': 'visual-complexity', 'direction': 'decrease'}],
            },
        })


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


class RepositoryUrlTests(unittest.TestCase):
    def test_https_and_ssh_clone_urls_share_an_identity(self):
        self.assertEqual(
            normalize_repo_url('https://gitlab.example/team/project.git'),
            normalize_repo_url('git@gitlab.example:team/project.git'),
        )

    def test_clone_credentials_are_not_stored(self):
        self.assertEqual(
            normalize_repo_url('https://gitlab-ci-token:secret@gitlab.example/team/project.git'),
            'gitlab.example/team/project',
        )


class HistorySelectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_run_and_branch_baselines_together(self):
        with self.assertRaises(HTTPException) as raised:
            await get_eval_result_history('backend-id', baseline_run_id=2, baseline_branch='main')
        self.assertEqual(raised.exception.status_code, 400)


class MetricResultIndexTests(unittest.TestCase):
    def test_prefers_non_empty_duplicate_result(self):
        indexed = metric_result_index([
            {'metric_id': 'm1_png_file_size', 'results': []},
            {'metric_id': 'm1_png_file_size', 'results': [42]},
        ])
        self.assertEqual(indexed['m1_png_file_size']['results'], [42])


class FileMetricRoutingTests(unittest.TestCase):
    def test_decodes_legacy_jsonb_backend_ids_for_migration(self):
        self.assertEqual(
            decode_backend_result_ids('["png-id", "html-id"]'),
            ['png-id', 'html-id']
        )

    def test_history_uses_every_backend_job_for_split_artifacts(self):
        self.assertEqual(
            backend_result_ids_for_run({
                'backend_result_ids': ['png-id', 'html-id'],
            }),
            ['png-id', 'html-id']
        )

    def test_unknown_run_falls_back_to_requested_backend_job(self):
        self.assertEqual(
            backend_result_ids_for_run(None, 'requested-id'),
            ['requested-id']
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


class EvaluationResultTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_backend_read_timeout_returns_pending_response(self):
        connection = AsyncMock()
        connection.fetchrow.return_value = {
            'id': 1,
            'metricsCount': 14,
            'status': 'PENDING',
            'backend_result_ids': ['backend-id'],
        }

        async def timed_out_fetch(client, backend_ids):
            self.assertEqual(client.timeout.read, 321.0)
            self.assertEqual(backend_ids, ['backend-id'])
            raise httpx.ReadTimeout('UIQLab is still processing')

        with patch('main.UIQLAB_RESULT_READ_TIMEOUT_SECONDS', 321.0), patch(
            'main.asyncpg.connect', AsyncMock(return_value=connection)
        ), patch(
            'main.fetch_merged_backend_results', side_effect=timed_out_fetch
        ):
            result = await get_eval_result('backend-id')

        self.assertEqual(result, [])
        connection.close.assert_awaited_once()


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
        self.assertIn('deterministicComparisonSelection', messages[1]['content'])
        self.assertIn('every item', messages[0]['content'])
        self.assertIn('Do not merely restate values', messages[0]['content'])
        self.assertIn('concrete, feasible suggestions', messages[0]['content'])

    def test_deterministically_orders_all_material_findings(self):
        current = [
            {'metric_id': 'm8_word_count', 'results': [150]},
            {'metric_id': 'm9_edge_density', 'results': [0.24]},
            {'metric_id': 'm10_feature_congestion', 'results': [5.0]},
            {'metric_id': 'm11_subband_entropy', 'results': [3.6]},
        ]
        history = {'metrics': {
            'm8_word_count': {'results': [100]},
            'm9_edge_density': {'results': [0.18]},
            'm10_feature_congestion': {'results': [4.0]},
            'm11_subband_entropy': {'results': [3.0]},
        }}

        first = select_comparison_findings(current, history)
        second = select_comparison_findings(list(reversed(current)), history)

        self.assertEqual(first['findings'], second['findings'])
        self.assertGreater(len(first['findings']), 3)
        self.assertEqual(first['findings'][0]['type'], 'cross-metric-pattern')
        self.assertEqual(
            first['findings'][0]['metricFamilies'],
            ['m9', 'm10', 'm11'],
        )

    def test_excludes_changes_below_fixed_materiality_rules(self):
        selection = select_comparison_findings(
            [{'metric_id': 'm9_edge_density', 'results': [0.181]}],
            {'metrics': {'m9_edge_density': {'results': [0.18]}}},
        )

        self.assertEqual(selection['materialChangeCount'], 0)
        self.assertEqual(selection['findings'], [])

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
