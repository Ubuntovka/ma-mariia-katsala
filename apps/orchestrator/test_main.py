import unittest

from main import metric_result_index, normalize_assessed_target


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


if __name__ == '__main__':
    unittest.main()
