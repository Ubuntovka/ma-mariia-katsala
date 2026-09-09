"""PostgreSQL-backed, deterministic explanations for the controlled experiment."""

import json


# This is the real project key from thesis-evaluation-projects/.uiqlab.json.
# Alpha and Beta are separate route families in this one repository/project.
EXPERIMENT_PROJECT_KEY = "5d66b2c8-0049-49f3-9e45-4f89349fe217"
EXPERIMENT_PROJECT_NAME = "thesis-evaluation-projects"
EXPERIMENT_REPOSITORY_URL = "github.com/ubuntovka/thesis-evaluation-projects"


def _suggestion(title: str, action: str, rationale: str) -> dict:
    return {
        "title": title,
        "action": action,
        "rationale": rationale,
        "files": [],
    }


def _response(
    goal_status: str,
    goal_title: str,
    summary: str,
    changes: list[str],
    suggestions: list[dict],
) -> dict:
    return {
        "explanation": summary,
        "profileFeedback": {
            "goalStatus": goal_status,
            "goalTitle": goal_title,
            "summary": summary,
            "changes": changes,
            "suggestions": suggestions,
            "sourceContextUsed": False,
            "sourceFiles": [],
        },
    }


# Lookup identity: (assessed_target, profile_id, direction). The PostgreSQL
# project_id for EXPERIMENT_PROJECT_KEY is added by the seed function.
FROZEN_RESPONSES = (
    (
        "/v/v3h9dp",
        "visual-clutter",
        "less-cluttered",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will perceive a cleaner, less dense interface that feels easier to scan and visually simpler.",
            [
                "Edge density dropped 26%, reducing perceived visual noise.",
                "Feature-congestion fell 12%, easing element overload.",
                "Subband entropy decreased 9%, lowering overall visual complexity.",
            ],
            [
                _suggestion(
                    "Increase whitespace around key sections",
                    "Add larger margin and padding values to primary container classes in the CSS",
                    "More whitespace reinforces the less-cluttered direction by giving elements breathing room, further reducing perceived density.",
                ),
                _suggestion(
                    "Consolidate decorative icons",
                    "Remove non-essential icons and replace groups of similar icons with a single representative symbol",
                    "Fewer decorative elements lower edge density and feature congestion, supporting a cleaner visual hierarchy.",
                ),
                _suggestion(
                    "Apply progressive disclosure for secondary options",
                    "Hide advanced settings behind an expandable panel or modal triggered on demand",
                    "Limiting visible controls at any moment cuts visual clutter and entropy, making the primary workflow more focused.",
                ),
                _suggestion(
                    "Simplify color palette",
                    "Reduce the number of distinct colors used for UI elements and adopt a restrained, high-contrast scheme",
                    "A limited palette reduces subband entropy and helps users quickly identify important elements, reinforcing the less-cluttered goal.",
                ),
            ],
        ),
    ),
    (
        "/v/n8t4cw",
        "screen-whitespace",
        "more-whitespace",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will perceive the page as less dense and easier to scan, with a calmer visual rhythm due to added whitespace.",
            [
                "White-space proportion rose from 0.76 to 0.80 (↑5%).",
                "The change is material (score 1.35) and meets the absolute-change threshold.",
                "Profile goal “more-whitespace” is marked achieved.",
            ],
            [
                _suggestion(
                    "Increase outer margins",
                    "Add larger left/right margins (e.g., 2 rem) to main containers.",
                    "Expands peripheral whitespace, reinforcing the less-dense perception.",
                ),
                _suggestion(
                    "Boost vertical spacing between sections",
                    "Raise the margin-bottom of section blocks by 1 rem.",
                    "Creates clearer separation, supporting the achieved whitespace direction.",
                ),
                _suggestion(
                    "Enlarge line-height for body text",
                    "Set line-height to 1.6 em on paragraph elements.",
                    "Improves readability and adds internal whitespace without altering content.",
                ),
                _suggestion(
                    "Add padding to interactive elements",
                    "Increase button and input padding by 0.5 rem on all sides.",
                    "Provides more breathing room around controls, aligning with the whitespace goal.",
                ),
            ],
        ),
    ),
    (
        "/v/y3b7se",
        "text-amount",
        "fewer-words",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will perceive the page as less text-dense, making scanning easier and reducing visual clutter.",
            [
                "Visible word count dropped from 188 to 154 (-34 words, -18%).",
                "The change meets materiality thresholds, confirming a meaningful reduction in text amount.",
            ],
            [
                _suggestion(
                    "Trim redundant copy",
                    "Audit page copy and remove filler sentences or duplicate information",
                    "Further cutting unnecessary words reinforces the fewer-words goal and improves scanability",
                ),
                _suggestion(
                    "Introduce clearer hierarchy",
                    "Add or emphasize headings and subheadings to break remaining text into bite-size sections",
                    "A stronger hierarchy guides attention, compensating for reduced word count while preserving information hierarchy",
                ),
                _suggestion(
                    "Leverage whitespace",
                    "Increase line-height and paragraph spacing around core content",
                    "More whitespace accentuates the leaner copy, enhancing perceived readability and reducing visual effort",
                ),
                _suggestion(
                    "Use concise UI labels",
                    "Review button and link labels to ensure they are as brief as possible without losing meaning",
                    "Consistent brevity across UI elements supports the overall fewer-words direction and streamlines user decision-making",
                ),
            ],
        ),
    ),
    (
        "/v/a4q9sn",
        "colorfulness",
        "more-colorful",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will notice a richer, more vivid visual experience with noticeably more colors across the interface, making the UI feel more lively and engaging.",
            [
                "Colorfulness score rose from 15.77 to 22.52, a 42.8% increase",
                "The change meets materiality thresholds (Δ>5 and >10% relative)",
                "Profile goal of becoming more colorful is marked as achieved",
            ],
            [
                _suggestion(
                    "Refine color palette for consistency",
                    "Audit the updated color set and align hues, saturation, and brightness across components to avoid jarring shifts",
                    "Consistent colors preserve the perceived increase while reducing visual noise, supporting the more-colorful goal",
                ),
                _suggestion(
                    "Validate accessibility contrast",
                    "Run contrast checks (WCAG AA/AAA) on the new colors and adjust any failing pairs",
                    "Ensuring legible contrast keeps the richer palette usable for all users, reinforcing the positive perception of vividness",
                ),
                _suggestion(
                    "A/B test with target users",
                    "Deploy the current color scheme to a test group and compare engagement metrics against the previous version",
                    "Empirical feedback confirms whether the increased colorfulness improves user satisfaction and task performance",
                ),
                _suggestion(
                    "Document color usage guidelines",
                    "Create a style guide that specifies when and where the new colors should be applied",
                    "Guidelines help maintain the achieved colorfulness in future updates and prevent regression",
                ),
            ],
        ),
    ),
    (
        "/v/f6z1jr",
        "accessibility",
        "fewer-detected-violations",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will find the interface easier to navigate with fewer hidden barriers, making interactions feel smoother and more inclusive.",
            [
                "Automated scans show a reduction in accessibility violations (m13).",
                "No new material regressions were introduced.",
                "The accessibility profile goal of fewer detected violations is achieved.",
            ],
            [
                _suggestion(
                    "Validate with manual accessibility testing",
                    "Run a manual audit using screen readers and keyboard navigation to confirm that the automated improvements cover real user scenarios.",
                    "Manual checks catch issues that automated tools miss, reinforcing the achieved goal.",
                ),
                _suggestion(
                    "Add missing ARIA landmarks and roles",
                    "Identify key page sections (header, navigation, main, footer) and apply appropriate ARIA attributes.",
                    "Clear landmarks improve screen-reader navigation, further reducing potential violations.",
                ),
                _suggestion(
                    "Ensure WCAG-AA color contrast",
                    "Audit text and UI element colors against contrast ratios and adjust any that fall below 4.5:1.",
                    "Strong contrast prevents visual accessibility issues that automated tools may flag.",
                ),
                _suggestion(
                    "Standardize keyboard focus indicators",
                    "Define a consistent focus style for all interactive elements and verify it appears on tab navigation.",
                    "Visible focus cues help keyboard-only users navigate without triggering violations.",
                ),
            ],
        ),
    ),
    (
        "/v/l5q9au",
        "visual-clutter",
        "less-cluttered",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will notice a cleaner layout with fewer competing visual elements, making scanning easier and reducing the effort to locate key information.",
            [
                "Edge density dropped 26%, indicating fewer sharp transitions.",
                "Feature-congestion fell 5%, suggesting reduced element crowding.",
                "Subband entropy decreased 5%, reflecting lower overall visual complexity.",
            ],
            [
                _suggestion(
                    "Increase whitespace around primary controls",
                    "Add margin or padding to main buttons and input fields to create visual breathing room.",
                    "More whitespace reinforces the less-cluttered direction and improves scan paths.",
                ),
                _suggestion(
                    "Consolidate decorative icons",
                    "Remove non-essential icons or merge similar symbols into a single representative graphic.",
                    "Fewer decorative elements further lowers edge density and feature congestion.",
                ),
                _suggestion(
                    "Apply a restrained color palette",
                    "Limit the number of distinct colors used for backgrounds, borders, and highlights to a core set.",
                    "A limited palette reduces subband entropy and helps users focus on important content.",
                ),
                _suggestion(
                    "Introduce progressive disclosure for secondary options",
                    "Hide less-frequent actions behind expandable sections or menus.",
                    "Showing only primary actions up front cuts visual clutter while preserving functionality.",
                ),
            ],
        ),
    ),
    (
        "/v/l5q9au",
        "visual-clutter",
        "more-cluttered",
        _response(
            "not-achieved",
            "Profile goals not achieved",
            "Likely users will find the interface relatively clean and easy to scan, with low visual density and modest visual complexity.",
            [
                "Edge density dropped by 26%, reducing the amount of edge detail perceived.",
                "Feature-congestion fell by 5%, decreasing the number of distinct visual elements.",
                "Subband entropy declined by 5%, lowering overall visual clutter.",
            ],
            [
                _suggestion(
                    "Add secondary visual elements",
                    "Introduce additional icons, badges, or status chips in sidebars and footers.",
                    "More distinct elements raise edge density and feature-congestion, moving metrics toward higher clutter.",
                ),
                _suggestion(
                    "Increase texture and pattern usage",
                    "Apply subtle background patterns or textured overlays to larger containers.",
                    "Textures add high-frequency detail, boosting subband entropy and perceived visual density.",
                ),
                _suggestion(
                    "Reduce whitespace around key components",
                    "Tighten padding and margins between cards, buttons, and form fields.",
                    "Denser layout raises edge density and feature-congestion, creating a more cluttered visual experience.",
                ),
                _suggestion(
                    "Introduce decorative accent colors",
                    "Add accent color highlights to secondary UI elements such as dividers, hover states, and icons.",
                    "Additional color variation increases visual complexity, contributing to higher subband entropy.",
                ),
            ],
        ),
    ),
    (
        "/v/c2x7pk",
        "screen-whitespace",
        "more-whitespace",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely user perceives the interface as more open and less crowded, making visual scanning easier and hierarchy clearer.",
            [
                "White-space proportion rose from 0.744 to 0.778, a material increase",
                "White-space distribution score increased, indicating more overall whitespace",
                "The change meets the material-change threshold for the ‘more-whitespace’ profile",
            ],
            [
                _suggestion(
                    "Add generous padding to section containers",
                    "Increase the CSS padding (or margin) on primary layout blocks (e.g., .section, .card) by 1–2 rem",
                    "Larger surrounding space reinforces the achieved ‘more-whitespace’ direction and further reduces perceived density",
                ),
                _suggestion(
                    "Introduce consistent vertical rhythm",
                    "Set a base line-height (e.g., 1.6) and apply uniform spacing between paragraphs and headings",
                    "Consistent vertical gaps enhance readability and sustain the open feel created by the whitespace increase",
                ),
                _suggestion(
                    "Break up dense content blocks",
                    "Split long paragraphs into shorter ones or use card components for related items",
                    "Reducing content density leverages the existing whitespace gain, helping users scan and locate information more efficiently",
                ),
            ],
        ),
    ),
    (
        "/v/t9f6ms",
        "text-amount",
        "fewer-words",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will perceive the page as less text-dense and easier to scan, with a clearer visual hierarchy due to fewer words on screen.",
            [
                "Visible word count dropped from 212 to 143 (-32.5%)",
                "Material change flagged as significant (score 3.45)",
                "Profile goal of fewer words achieved",
            ],
            [
                _suggestion(
                    "Trim non-essential copy",
                    "Audit content sections and rewrite or remove filler sentences to further reduce word count while preserving meaning",
                    "Continuing the trend toward fewer words reinforces perceived simplicity and reduces cognitive load",
                ),
                _suggestion(
                    "Introduce visual hierarchy",
                    "Add headings, sub-headings, and bullet lists to break remaining text into scannable chunks",
                    "With less text, clear hierarchy guides attention and supports the ‘fewer-words’ experience",
                ),
                _suggestion(
                    "Increase white space",
                    "Adjust padding and margin around text blocks to create more breathing room",
                    "More whitespace amplifies the effect of reduced copy, making the interface feel lighter and easier to read",
                ),
                _suggestion(
                    "Validate readability",
                    "Run a readability test (e.g., Flesch-Kincaid) on the revised copy and aim for a lower grade level",
                    "Simpler language complements fewer words, further enhancing user comprehension and scanning efficiency",
                ),
            ],
        ),
    ),
    (
        "/v/m8r3vk",
        "colorfulness",
        "more-colorful",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will notice a richer, more vivid visual experience with noticeably more color throughout the interface.",
            [
                "Perceived colorfulness rose by ~40% (from 24.96 to 34.88), a material increase.",
                "The change meets absolute (≥5) and relative (≥10%) thresholds, confirming a meaningful shift.",
            ],
            [
                _suggestion(
                    "Introduce accent hues",
                    "Add a limited set of brand-aligned accent colors to key interactive elements (buttons, links, icons).",
                    "Targeted accents boost overall colorfulness without overwhelming users, reinforcing the more-colorful goal.",
                ),
                _suggestion(
                    "Enhance background gradients",
                    "Replace solid backgrounds with subtle multi-tone gradients in major sections.",
                    "Gradients increase chromatic variety across large areas, raising perceived color richness while preserving readability.",
                ),
                _suggestion(
                    "Apply colored illustrations",
                    "Integrate illustrative graphics that use a broader palette than current line icons.",
                    "Illustrations contribute diverse hues, amplifying the vividness metric without altering core UI components.",
                ),
                _suggestion(
                    "A/B test saturation levels",
                    "Run an experiment comparing the current palette to a version with slightly higher saturation on secondary UI elements.",
                    "Empirically confirms that increased saturation improves perceived colorfulness without harming usability.",
                ),
            ],
        ),
    ),
    (
        "/v/w7j4bn",
        "accessibility",
        "fewer-detected-violations",
        _response(
            "achieved",
            "Profile goal achieved",
            "Likely users will encounter fewer barriers, perceiving the interface as more navigable and inclusive.",
            [
                "Automated scans show a reduction in accessibility violations (m13).",
                "The site now aligns with the chosen accessibility profile goal.",
                "Improved compliance should lower effort for users relying on assistive technologies.",
            ],
            [
                _suggestion(
                    "Integrate Continuous Accessibility Testing",
                    "Add an automated accessibility audit (e.g., axe-core) to the CI pipeline and fail builds on new violations.",
                    "Ensures future changes maintain the trend of fewer detected violations and catches regressions early.",
                ),
                _suggestion(
                    "Enhance Semantic HTML and ARIA",
                    "Review component markup to replace generic divs with appropriate semantic elements and add missing ARIA attributes where needed.",
                    "Semantic structure and ARIA improve screen-reader interpretation, directly reducing violation counts.",
                ),
                _suggestion(
                    "Keyboard-Only Navigation Audit",
                    "Conduct a systematic keyboard navigation test across all interactive elements and fix focus order or trap issues.",
                    "Keyboard accessibility is a common source of violations; fixing it will further lower m13 scores.",
                ),
                _suggestion(
                    "User Testing with Assistive Tech",
                    "Run short usability sessions with screen-reader and voice-control users, documenting any friction points.",
                    "Real-world feedback uncovers issues that automated tools may miss, supporting continued reduction of violations.",
                ),
            ],
        ),
    ),
)


async def migrate_frozen_explanations(conn) -> None:
    """Create the smallest storage model needed for frozen structured DTOs."""
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS frozen_explanation (
            id SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            assessed_target TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            direction TEXT NOT NULL,
            response JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (project_id, assessed_target, profile_id, direction)
        );
        """
    )


async def seed_frozen_explanations(conn) -> int:
    """Idempotently upsert every prepared experiment response."""
    project_id = await conn.fetchval(
        """
        INSERT INTO project (project_key, project_name, "repositoryUrl")
        VALUES ($1::uuid, $2, $3)
        ON CONFLICT (project_key) DO UPDATE SET
            project_name = COALESCE(project.project_name, EXCLUDED.project_name),
            "repositoryUrl" = COALESCE(NULLIF(project."repositoryUrl", ''), EXCLUDED."repositoryUrl")
        RETURNING id
        """,
        EXPERIMENT_PROJECT_KEY,
        EXPERIMENT_PROJECT_NAME,
        EXPERIMENT_REPOSITORY_URL,
    )
    await conn.executemany(
        """
        INSERT INTO frozen_explanation (
            project_id, assessed_target, profile_id, direction, response
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (project_id, assessed_target, profile_id, direction)
        DO UPDATE SET response = EXCLUDED.response, updated_at = NOW()
        """,
        [
            (project_id, target, profile_id, direction, json.dumps(response, ensure_ascii=False))
            for target, profile_id, direction, response in FROZEN_RESPONSES
        ],
    )
    return len(FROZEN_RESPONSES)


def decode_frozen_response(value) -> dict:
    """Normalize asyncpg JSONB codecs and reject corrupt frozen records."""
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise ValueError("Frozen response is not a JSON object")
    feedback = value.get("profileFeedback")
    if not isinstance(value.get("explanation"), str) or not isinstance(feedback, dict):
        raise ValueError("Frozen response does not match the explanation DTO")
    return value
