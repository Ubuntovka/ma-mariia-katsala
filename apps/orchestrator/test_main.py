import asyncio
import json
import os
import unittest
from datetime import datetime, timezone
from fastapi import HTTPException
from unittest.mock import AsyncMock, patch
from uuid import UUID

import asyncpg
import httpx

from main import (
    assessment_run_summary,
    backend_result_ids_for_run,
    build_explanation_messages,
    compact_source_context,
    decode_backend_result_ids,
    extract_custom_metric_llm_feedback,
    extract_llm_explanation,
    extract_profile_llm_feedback,
    ExplainAssessmentInput,
    explain_assessment,
    fetch_merged_backend_results,
    merge_metric_results,
    metric_result_index,
    normalize_assessed_target,
    normalize_repo_url,
    normalize_service_base_url,
    resolve_llm_chat_completions_url,
    select_comparison_findings,
    split_file_metrics,
    get_eval_result,
    get_eval_result_history,
)
from frozen_responses import (
    EXPERIMENT_PROJECT_KEY,
    FROZEN_RESPONSES,
    migrate_frozen_explanations,
    seed_frozen_explanations,
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
                'profiles': [{'id': 'visual-clutter', 'direction': 'less-cluttered'}],
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
                'profiles': [{'id': 'visual-clutter', 'direction': 'less-cluttered'}],
            },
        })

    def test_decodes_jsonb_assessment_strings_returned_by_asyncpg(self):
        created_at = datetime(2026, 8, 11, 12, 30, tzinfo=timezone.utc)
        summary = assessment_run_summary({
            'id': 18,
            'createdAt': created_at,
            'commitHash': None,
            'gitDirty': False,
            'branch': 'main',
            'assessedTarget': '/',
            'screenshotWidth': None,
            'screenshotHeight': None,
            'assessment': '{"mode":"profiles","profiles":[{"id":"accessibility","direction":"fewer-detected-violations"}]}',
        })

        self.assertEqual(summary['assessment'], {
            'mode': 'profiles',
            'profiles': [{'id': 'accessibility', 'direction': 'fewer-detected-violations'}],
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


class ServiceBaseUrlTests(unittest.TestCase):
    def test_removes_whitespace_and_trailing_slashes(self):
        self.assertEqual(
            normalize_service_base_url(' https://backend.example/// ', 'BACKEND_URL'),
            'https://backend.example'
        )

    def test_requires_an_http_url_with_a_hostname(self):
        with self.assertRaisesRegex(RuntimeError, 'http:// or https://'):
            normalize_service_base_url('backend.example', 'BACKEND_URL')
        with self.assertRaisesRegex(RuntimeError, 'http:// or https://'):
            normalize_service_base_url('ftp://backend.example', 'BACKEND_URL')


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

    def test_custom_prompt_contains_current_history_and_professional_guidance(self):
        messages = build_explanation_messages(
            [{'metric_id': 'm9_edge_density', 'results': [0.24]}],
            {'metrics': {
                'm9_edge_density': {'results': [0.18], 'createdAt': '2026-01-01T12:00:00Z'}
            }},
            {'mode': 'custom'},
            target='http://localhost:3000/dashboard',
            source_context=[{
                'path': 'src/pages/dashboard.tsx',
                'content': '<main className="dashboard">Dashboard</main>',
            }],
        )

        self.assertIn('software engineers', messages[0]['content'])
        self.assertIn('Do not use slang', messages[0]['content'])
        self.assertIn('Return JSON only', messages[0]['content'])
        self.assertIn('Edge density', messages[1]['content'])
        self.assertIn('0.24', messages[1]['content'])
        self.assertIn('0.18', messages[1]['content'])
        self.assertIn('deterministicComparisonSelection', messages[1]['content'])
        self.assertIn('every item', messages[0]['content'])
        self.assertIn('Do not merely repeat the displayed values', messages[0]['content'])
        self.assertIn('what to change in the interface or implementation', messages[0]['content'])
        self.assertIn('Retesting may confirm a change', messages[0]['content'])
        self.assertIn('primary action is to analyze', messages[0]['content'])
        self.assertIn('potential user', messages[0]['content'])
        self.assertIn('what may draw attention', messages[0]['content'])
        self.assertIn('code-informed hypothesis', messages[0]['content'])
        self.assertIn('src/pages/dashboard.tsx', messages[1]['content'])
        self.assertIn('http://localhost:3000/dashboard', messages[1]['content'])

    def test_extracts_and_filters_structured_custom_metric_feedback(self):
        feedback = extract_custom_metric_llm_feedback({
            'choices': [{'message': {'content': '''```json
            {
              "summary": "The clutter indicators increased relative to the baseline.",
              "findings": [{
                "title": "Corroborating clutter measurements",
                "metricIds": ["m9_edge_density", "m10", "m99"],
                "observation": "Edge density and feature congestion increased.",
                "interpretation": "The measurements indicate greater visual information density.",
                "recommendation": "Isolate one layout change and repeat both measurements.",
                "files": ["src/pages/dashboard.tsx", "invented.tsx"]
              }]
            }
            ```'''}}]
        }, ['m9', 'm10'], ['src/pages/dashboard.tsx'])

        self.assertEqual(feedback['summary'], 'The clutter indicators increased relative to the baseline.')
        self.assertEqual(feedback['findings'][0]['metricIds'], ['M9', 'M10'])
        self.assertNotIn('M99', feedback['findings'][0]['metricIds'])
        self.assertEqual(feedback['findings'][0]['files'], ['src/pages/dashboard.tsx'])

    def test_replaces_research_only_custom_recommendation_with_practical_action(self):
        feedback = extract_custom_metric_llm_feedback({
            'choices': [{'message': {'content': '''{
              "summary": "Edge density increased.",
              "findings": [{
                "title": "Higher edge density",
                "metricIds": ["m9"],
                "observation": "M9 increased relative to the baseline.",
                "interpretation": "The view may contain more competing visual boundaries.",
                "recommendation": "Conduct additional analysis to determine the underlying cause."
              }]
            }'''}}]
        }, ['m9'])

        recommendation = feedback['findings'][0]['recommendation']
        self.assertTrue(recommendation.startswith('Remove or simplify'))
        self.assertIn('rerun the listed metrics', recommendation)
        self.assertNotIn('Conduct additional analysis', recommendation)

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

    def test_profile_prompt_uses_authoritative_outcome_and_opt_in_source(self):
        messages = build_explanation_messages(
            [{'metric_id': 'm9_edge_density', 'results': [0.16]}],
            {'metrics': {'m9_edge_density': {'results': [0.24]}}},
            {'mode': 'profiles', 'profiles': [
                {'id': 'visual-clutter', 'direction': 'less-cluttered'}
            ]},
            {
                'status': 'achieved',
                'title': 'Profile goal achieved',
                'outcomes': [{'id': 'visual-clutter', 'goalStatus': 'achieved'}],
            },
            'http://localhost:3000/dashboard',
            [{'path': 'src/pages/dashboard.tsx', 'content': '<main>Dashboard</main>'}],
        )

        self.assertIn('deterministicProfileOutcome is authoritative', messages[0]['content'])
        self.assertIn('Return JSON only', messages[0]['content'])
        self.assertIn('Profile goal achieved', messages[1]['content'])
        self.assertIn('src/pages/dashboard.tsx', messages[1]['content'])
        self.assertIn('<main>Dashboard</main>', messages[1]['content'])
        self.assertIn('untrusted data', messages[0]['content'])

    def test_source_free_profile_prompt_omits_raw_result_artifacts(self):
        messages = build_explanation_messages(
            [{'metric_id': 'm10_feature_congestion', 'results': [
                {'score': 4.2, 'map': 'large-raw-artifact' * 1000}
            ]}],
            {'metrics': {'m10_feature_congestion': {'results': [{'score': 5.1}]}}},
            {'mode': 'profiles', 'profiles': [
                {'id': 'visual-clutter', 'direction': 'less-cluttered'}
            ]},
            {'status': 'achieved', 'title': 'Profile goal achieved', 'outcomes': []},
        )

        self.assertNotIn('large-raw-artifact', messages[1]['content'])
        self.assertIn('"sourceFiles": []', messages[1]['content'])
        self.assertIn('deterministicComparisonSelection', messages[1]['content'])

    def test_compacts_source_context_to_allowed_limits(self):
        compacted = compact_source_context([
            {'path': f'src/file-{index}.tsx', 'content': 'x' * (30 * 1024)}
            for index in range(12)
        ])

        self.assertLessEqual(len(compacted), 10)
        self.assertLessEqual(sum(len(item['content'].encode('utf-8')) for item in compacted), 100 * 1024)
        self.assertTrue(all(len(item['content'].encode('utf-8')) <= 24 * 1024 for item in compacted))

    def test_extracts_and_filters_structured_profile_feedback(self):
        feedback = extract_profile_llm_feedback({
            'choices': [{'message': {'content': '''```json
            {
              "summary": "The profile goal was achieved.",
              "changes": ["Edge density decreased."],
              "suggestions": [{
                "title": "Keep the hierarchy",
                "action": "Review the dashboard spacing after future changes.",
                "rationale": "This helps preserve the selected direction.",
                "files": ["src/dashboard.tsx", "invented.tsx"]
              }]
            }
            ```'''}}]
        }, ['src/dashboard.tsx'])

        self.assertEqual(feedback['summary'], 'The profile goal was achieved.')
        self.assertEqual(feedback['changes'], ['Edge density decreased.'])
        self.assertEqual(feedback['suggestions'][0]['files'], ['src/dashboard.tsx'])

    def test_accepts_provider_text_before_structured_profile_feedback(self):
        feedback = extract_profile_llm_feedback({
            'choices': [{'message': {'content': '''Here is the requested result:
            {"summary":"Metrics moved toward the goal.","changes":[],"suggestions":[]}
            '''}}]
        })

        self.assertEqual(feedback['summary'], 'Metrics moved toward the goal.')


class FrozenExplanationDataTests(unittest.TestCase):
    def test_contains_all_eleven_unique_conditions_with_required_card_counts(self):
        keys = [(target, profile_id, direction) for target, profile_id, direction, _ in FROZEN_RESPONSES]
        self.assertEqual(len(FROZEN_RESPONSES), 11)
        self.assertEqual(len(set(keys)), 11)
        for target, profile_id, direction, response in FROZEN_RESPONSES:
            feedback = response['profileFeedback']
            expected_suggestions = 3 if target == '/v/c2x7pk' else 4
            self.assertEqual(len(feedback['suggestions']), expected_suggestions)
            self.assertTrue(feedback['changes'])
            self.assertTrue(all(item['action'] and item['rationale'] for item in feedback['suggestions']))
            self.assertFalse(feedback['sourceContextUsed'])
            self.assertEqual(feedback['sourceFiles'], [])

    def test_beta_opposite_visual_clutter_conditions_do_not_collide(self):
        beta = {
            direction: response
            for target, profile_id, direction, response in FROZEN_RESPONSES
            if target == '/v/l5q9au' and profile_id == 'visual-clutter'
        }
        self.assertEqual(set(beta), {'less-cluttered', 'more-cluttered'})
        self.assertEqual(beta['less-cluttered']['profileFeedback']['goalStatus'], 'achieved')
        self.assertEqual(beta['more-cluttered']['profileFeedback']['goalStatus'], 'not-achieved')
        self.assertEqual(
            beta['more-cluttered']['profileFeedback']['goalTitle'],
            'Profile goals not achieved',
        )


class FrozenExplanationSeedTests(unittest.IsolatedAsyncioTestCase):
    async def test_migration_uses_jsonb_and_seed_is_idempotent(self):
        connection = AsyncMock()
        connection.fetchval.return_value = 273

        await migrate_frozen_explanations(connection)
        first_count = await seed_frozen_explanations(connection)
        second_count = await seed_frozen_explanations(connection)

        self.assertEqual(first_count, 11)
        self.assertEqual(second_count, 11)
        self.assertIn('response JSONB NOT NULL', connection.execute.await_args.args[0])
        seed_sql, seed_rows = connection.executemany.await_args_list[0].args
        self.assertIn('ON CONFLICT (project_id, assessed_target, profile_id, direction)', seed_sql)
        self.assertEqual(len(seed_rows), 11)
        self.assertTrue(all(isinstance(json.loads(row[4]), dict) for row in seed_rows))


class FrozenExplanationEndpointTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def payload(target, profile_id, direction, project_key=EXPERIMENT_PROJECT_KEY):
        return ExplainAssessmentInput(
            projectKey=project_key,
            currentResults=[{'metric_id': 'm9_edge_density', 'results': [0.2]}],
            assessment={
                'mode': 'profiles',
                'profiles': [{'id': profile_id, 'direction': direction}],
            },
            profileAssessment={'status': 'achieved', 'title': 'Ignored live outcome'},
            target=f'http://localhost:3000{target}?ignored=yes',
        )

    async def test_every_condition_returns_exact_prepared_dto_and_never_constructs_llm_client(self):
        for target, profile_id, direction, expected in FROZEN_RESPONSES:
            connection = AsyncMock()
            connection.fetchval.return_value = json.dumps(expected, ensure_ascii=False)
            with self.subTest(target=target, profile=profile_id, direction=direction), patch(
                'main.asyncpg.connect', AsyncMock(return_value=connection)
            ), patch('main.httpx.AsyncClient') as llm_client:
                actual = await explain_assessment(self.payload(target, profile_id, direction))

            self.assertEqual(actual, expected)
            llm_client.assert_not_called()
            query_args = connection.fetchval.await_args.args
            self.assertEqual(query_args[1:], (
                UUID(EXPERIMENT_PROJECT_KEY), target, profile_id, direction
            ))
            connection.close.assert_awaited_once()

    async def test_repeated_requests_are_identical_database_lookups(self):
        expected = FROZEN_RESPONSES[0][3]
        connection = AsyncMock()
        connection.fetchval.return_value = expected
        connector = AsyncMock(return_value=connection)
        payload = self.payload('/v/v3h9dp', 'visual-clutter', 'less-cluttered')

        with patch('main.asyncpg.connect', connector), patch('main.httpx.AsyncClient') as llm_client:
            first = await explain_assessment(payload)
            second = await explain_assessment(payload)

        self.assertEqual(first, second)
        self.assertEqual(connector.await_count, 2)
        self.assertEqual(connection.fetchval.await_count, 2)
        llm_client.assert_not_called()

    async def test_unknown_project_condition_and_missing_record_fail_closed(self):
        scenarios = (
            self.payload('/v/v3h9dp', 'visual-clutter', 'less-cluttered', '00000000-0000-0000-0000-000000000000'),
            self.payload('/v/v3h9dp', 'unknown-profile', 'unknown-direction'),
            self.payload('/v/unknown', 'visual-clutter', 'less-cluttered'),
        )
        for payload in scenarios:
            connection = AsyncMock()
            connection.fetchval.return_value = None
            with self.subTest(payload=payload), patch(
                'main.asyncpg.connect', AsyncMock(return_value=connection)
            ), patch('main.httpx.AsyncClient') as llm_client:
                with self.assertRaises(HTTPException) as raised:
                    await explain_assessment(payload)

            self.assertEqual(raised.exception.status_code, 404)
            self.assertIn('No frozen response exists', raised.exception.detail)
            llm_client.assert_not_called()

    async def test_database_error_has_no_retry_or_llm_fallback(self):
        connector = AsyncMock(side_effect=asyncpg.PostgresError('database unavailable'))
        with patch('main.asyncpg.connect', connector), patch('main.httpx.AsyncClient') as llm_client:
            with self.assertRaises(HTTPException) as raised:
                await explain_assessment(
                    self.payload('/v/v3h9dp', 'visual-clutter', 'less-cluttered')
                )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(connector.await_count, 1)
        llm_client.assert_not_called()

    async def test_live_provider_environment_cannot_enable_network_generation(self):
        expected = FROZEN_RESPONSES[0][3]
        connection = AsyncMock()
        connection.fetchval.return_value = expected
        with patch.dict(os.environ, {
            'LLM_API_URL': 'https://provider.example/v1',
            'LLM_API_KEY': 'secret',
            'LLM_MODEL': 'live-model',
        }), patch('main.asyncpg.connect', AsyncMock(return_value=connection)), patch(
            'main.httpx.AsyncClient'
        ) as llm_client:
            actual = await explain_assessment(
                self.payload('/v/v3h9dp', 'visual-clutter', 'less-cluttered')
            )

        self.assertEqual(actual, expected)
        llm_client.assert_not_called()

    async def test_non_profile_and_ambiguous_profile_requests_fail_before_database_or_llm(self):
        payloads = (
            ExplainAssessmentInput(
                projectKey=EXPERIMENT_PROJECT_KEY,
                currentResults=[{'metric_id': 'm9', 'results': [0.2]}],
                assessment={'mode': 'custom'},
                target='/v/v3h9dp',
            ),
            ExplainAssessmentInput(
                projectKey=EXPERIMENT_PROJECT_KEY,
                currentResults=[{'metric_id': 'm9', 'results': [0.2]}],
                assessment={'mode': 'profiles', 'profiles': [
                    {'id': 'visual-clutter', 'direction': 'less-cluttered'},
                    {'id': 'screen-whitespace', 'direction': 'more-whitespace'},
                ]},
                target='/v/v3h9dp',
            ),
        )
        for payload in payloads:
            with self.subTest(payload=payload), patch('main.asyncpg.connect') as connector, patch(
                'main.httpx.AsyncClient'
            ) as llm_client:
                with self.assertRaises(HTTPException) as raised:
                    await explain_assessment(payload)
            self.assertEqual(raised.exception.status_code, 404)
            connector.assert_not_called()
            llm_client.assert_not_called()


if __name__ == '__main__':
    unittest.main()
