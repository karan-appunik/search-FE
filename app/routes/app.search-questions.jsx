import { useEffect, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import {
  Banner,
  Button,
  EmptyState,
  Icon,
  Page,
  Switch,
  TextField
} from "../components/ui";

// =========================================================
// SEARCH QUESTIONS
// =========================================================
//
// Lets the merchant write 5–7 questions that appear as
// suggestions in their theme's own search bar (when it is
// focused and empty). Selecting one runs it through the
// existing AI search and opens the full search results page —
// see the SEARCH QUESTIONS section in
// extensions/ai-product-search/assets/ai-search.js.
//
// Storage: one JSON app-data metafield on this app's
// installation (AppInstallation, ai_search.search_questions):
//   - tied to the shop by Shopify, writable only by this app,
//     no extra access scope, removed on uninstall;
//   - rendered into the storefront page by the app embed's
//     Liquid (app.metafields), so storefronts make no extra
//     request and the backend/MongoDB are not involved.
//
// "Test" uses the existing /api/search-preview route (the same
// AI search the storefront uses). No new search logic.
// =========================================================

const NAMESPACE = "ai_search";
const KEY = "search_questions";

const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 7;
const MIN_LENGTH = 3;
const MAX_LENGTH = 120;
const MAX_HEADING_LENGTH = 60;
const DEFAULT_HEADING = "Try asking";

const QUESTIONS_QUERY = `#graphql
  query SearchQuestions {
    currentAppInstallation {
      id
      searchQuestions: metafield(namespace: "ai_search", key: "search_questions") {
        jsonValue
      }
    }
  }
`;

const SAVE_QUESTIONS_MUTATION = `#graphql
  mutation SaveSearchQuestions($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;


// =========================================================
// VALIDATION (shared by the form and the action)
// =========================================================

function cleanText(value) {
  return String(value == null ? "" : value)
    // Control characters (e.g. pasted line breaks/tabs).
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Returns the cleaned config plus any errors. `questions` keeps
 * every row (including empty ones) so errors line up with the
 * form; empty rows are dropped from what gets saved.
 */
function validateQuestions(input) {
  const enabled = input?.enabled === true;
  const heading = cleanText(input?.heading);
  const rows = Array.isArray(input?.questions)
    ? input.questions.map(cleanText)
    : [];

  const errors = { questions: rows.map(() => ""), form: "" };
  const seen = new Map();

  rows.forEach((question, index) => {
    if (!question) {
      return;
    }

    if (question.length < MIN_LENGTH) {
      errors.questions[index] = `Use at least ${MIN_LENGTH} characters.`;
    } else if (question.length > MAX_LENGTH) {
      errors.questions[index] = `Use ${MAX_LENGTH} characters or fewer.`;
    } else if (/[<>]/.test(question)) {
      errors.questions[index] = "Plain text only: remove < and >.";
    } else {
      const key = question.toLowerCase();

      if (seen.has(key)) {
        errors.questions[index] = `Same as question ${seen.get(key) + 1}.`;
      } else {
        seen.set(key, index);
      }
    }
  });

  const questions = rows.filter(Boolean);

  if (questions.length > MAX_QUESTIONS) {
    errors.form = `You can add up to ${MAX_QUESTIONS} questions.`;
  } else if (enabled && questions.length < MIN_QUESTIONS) {
    errors.form =
      `Add at least ${MIN_QUESTIONS} questions to show them on your store ` +
      `(${questions.length} so far), or turn off "Show questions in the search bar".`;
  }

  if (heading.length > MAX_HEADING_LENGTH) {
    errors.heading = `Use ${MAX_HEADING_LENGTH} characters or fewer.`;
  } else if (/[<>]/.test(heading)) {
    errors.heading = "Plain text only: remove < and >.";
  }

  const valid =
    !errors.form &&
    !errors.heading &&
    errors.questions.every(message => !message);

  return {
    valid,
    errors,
    config: {
      enabled,
      heading: heading || DEFAULT_HEADING,
      questions
    }
  };
}

function normalizeStored(value) {
  return {
    enabled: value?.enabled === true,
    heading: cleanText(value?.heading) || DEFAULT_HEADING,
    questions: Array.isArray(value?.questions)
      ? value.questions.map(cleanText).filter(Boolean).slice(0, MAX_QUESTIONS)
      : []
  };
}


// =========================================================
// LOADER / ACTION
// =========================================================

async function readInstallation(admin) {
  const response = await admin.graphql(QUESTIONS_QUERY);
  const { data } = await response.json();
  const installation = data?.currentAppInstallation;

  return {
    installationId: installation?.id || "",
    config: normalizeStored(installation?.searchQuestions?.jsonValue)
  };
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const { config } = await readInstallation(admin);

    return { config, loadError: null };
  } catch (error) {
    // Shopify auth responses (re-auth) must reach the browser as-is.
    if (error instanceof Response) {
      throw error;
    }

    console.error("[SEARCH QUESTIONS] Failed to load", {
      shop: session.shop,
      error: error?.message || error
    });

    return {
      config: normalizeStored(null),
      loadError: "Questions could not be loaded. Please refresh the page."
    };
  }
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  let payload;

  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "Invalid request." };
  }

  // Never trust the browser: validate again on the server.
  const { valid, errors, config } = validateQuestions(payload);

  if (!valid) {
    return { ok: false, error: errors.form || "Please fix the highlighted fields.", errors };
  }

  try {
    const { installationId } = await readInstallation(admin);

    if (!installationId) {
      throw new Error("App installation id unavailable");
    }

    const response = await admin.graphql(SAVE_QUESTIONS_MUTATION, {
      variables: {
        metafields: [
          {
            ownerId: installationId,
            namespace: NAMESPACE,
            key: KEY,
            type: "json",
            value: JSON.stringify(config)
          }
        ]
      }
    });

    const { data } = await response.json();
    const userErrors = data?.metafieldsSet?.userErrors || [];

    if (userErrors.length) {
      console.error("[SEARCH QUESTIONS] metafieldsSet userErrors", {
        shop: session.shop,
        userErrors
      });

      return { ok: false, error: "Questions could not be saved. Please try again." };
    }

    console.log("[SEARCH QUESTIONS] Saved", {
      shop: session.shop,
      enabled: config.enabled,
      count: config.questions.length
    });

    return { ok: true, config };
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    console.error("[SEARCH QUESTIONS] Failed to save", {
      shop: session.shop,
      error: error?.message || error
    });

    return { ok: false, error: "Questions could not be saved. Please try again." };
  }
};


// =========================================================
// PAGE
// =========================================================

function sameConfig(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function SearchQuestions() {
  const { config: initialConfig, loadError } = useLoaderData();
  const saveFetcher = useFetcher();
  const testFetcher = useFetcher();

  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [heading, setHeading] = useState(initialConfig.heading);
  const [questions, setQuestions] = useState(initialConfig.questions);
  const [saved, setSaved] = useState(initialConfig);
  const [testedIndex, setTestedIndex] = useState(null);
  const [testedQuestion, setTestedQuestion] = useState("");

  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data?.ok) {
      setSaved(saveFetcher.data.config);
      setQuestions(saveFetcher.data.config.questions);
      setHeading(saveFetcher.data.config.heading);
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const { valid, errors, config } = validateQuestions({ enabled, heading, questions });
  const filledCount = config.questions.length;
  const hasChanges = !sameConfig(config, saved);
  const isSaving = saveFetcher.state !== "idle";
  const serverErrors = saveFetcher.state === "idle" && saveFetcher.data?.ok === false
    ? saveFetcher.data
    : null;

  const updateQuestion = (index, value) => {
    setQuestions(current => current.map((question, i) => (i === index ? value : question)));
  };

  const moveQuestion = (index, direction) => {
    setQuestions(current => {
      const target = index + direction;

      if (target < 0 || target >= current.length) {
        return current;
      }

      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setTestedIndex(null);
  };

  const removeQuestion = (index) => {
    setQuestions(current => current.filter((_, i) => i !== index));
    setTestedIndex(null);
  };

  const addQuestion = () => {
    setQuestions(current =>
      current.length >= MAX_QUESTIONS ? current : [...current, ""]
    );
  };

  const testQuestion = (index) => {
    const question = validateQuestions({ questions: [questions[index]] }).config.questions[0];

    if (!question) {
      return;
    }

    setTestedIndex(index);
    setTestedQuestion(question);
    testFetcher.load(
      `/api/search-preview?${new URLSearchParams({ q: question, mode: "final" }).toString()}`
    );
  };

  const save = () => {
    saveFetcher.submit(
      { enabled, heading, questions },
      { method: "POST", encType: "application/json" }
    );
  };

  const testResult = testFetcher.data;
  const isTesting = testFetcher.state !== "idle";

  // Display only: progress of each step and the saved state.
  const questionsReady =
    filledCount >= MIN_QUESTIONS && errors.questions.every(message => !message);
  const headingReady = Boolean(cleanText(heading)) && !errors.heading;
  const isLive = saved.enabled && saved.questions.length >= MIN_QUESTIONS;

  return (
    <Page>
      {/* ---------- Header ---------- */}
      <header className="dash-hero">
        <div className="dash-hero__text">
          <Link to="/app" className="gr-back">
            <Icon name="back" size={13} />
            Dashboard
          </Link>
          <h1 className="dash-hero__title">Search questions</h1>
          <p className="dash-hero__sub">
            Suggest questions shoppers can tap when they open your search bar. Each one opens
            the results page with matching products.
          </p>
        </div>

        <div className="dash-hero__side">
          <span className={`dash-pill${isLive ? "" : " dash-pill--warn"}`}>
            <span className="dash-pill__dot" aria-hidden="true" />
            {isLive ? "Turned on" : "Turned off"}
          </span>
        </div>
      </header>

      {loadError && <Banner tone="critical">{loadError}</Banner>}

      {saveFetcher.state === "idle" && saveFetcher.data?.ok && !hasChanges && (
        <Banner tone="success">Questions saved.</Banner>
      )}

      {serverErrors && <Banner tone="critical">{serverErrors.error}</Banner>}

      <section className="dash-card" aria-labelledby="sq-setup">
        <div className="dash-card__head">
          <h2 id="sq-setup" className="dash-card__title">Set up questions</h2>
          <span className="dash-card__meta">3 quick steps</span>
        </div>

        <ol className="gr-steps">
          {/* 1. Heading */}
          <li className="gr-step">
            <span className={`dash-num ${headingReady ? "dash-tone--sage" : "dash-tone--slate"}`} aria-hidden="true">
              {headingReady ? <Icon name="check" size={13} strokeWidth={2.4} /> : "1"}
            </span>
            <div className="gr-step__body">
              <label htmlFor="questions-heading" className="gr-step__title">Heading</label>
              <p className="gr-step__text">Shown above the questions in your search bar.</p>
              <div className="gr-step__field">
                <TextField
                  id="questions-heading"
                  value={heading}
                  maxLength={MAX_HEADING_LENGTH}
                  showCount
                  error={errors.heading || undefined}
                  onChange={setHeading}
                />
              </div>
            </div>
          </li>

          {/* 2. Questions */}
          <li className="gr-step">
            <span className={`dash-num ${questionsReady ? "dash-tone--sage" : "dash-tone--mauve"}`} aria-hidden="true">
              {questionsReady ? <Icon name="check" size={13} strokeWidth={2.4} /> : "2"}
            </span>
            <div className="gr-step__body">
              <span className="gr-step__title">
                Write {MIN_QUESTIONS}–{MAX_QUESTIONS} questions
                <span className={`gr-count${filledCount ? " gr-count--on" : ""}`}>
                  {filledCount} of {MAX_QUESTIONS}
                </span>
              </span>
              <p className="gr-step__text">
                Write them the way shoppers ask. Use Test to check which products the AI finds.
              </p>

              {errors.form && (
                <div className="sq-form-error">
                  <Banner tone="warning">{errors.form}</Banner>
                </div>
              )}

              {questions.length === 0 ? (
                <div className="sq-empty">
                  <EmptyState icon="question">
                    No questions yet. Click &quot;Add question&quot; to write your first one.
                  </EmptyState>
                </div>
              ) : (
                <div className="sq-list">
                  {questions.map((question, index) => (
                    <div className="sq-q" key={index}>
                      <div className="sq-q__row">
                        <span className="sq-q__num" aria-hidden="true">{index + 1}</span>

                        <div className="sq-q__field">
                          <TextField
                            id={`question-${index}`}
                            aria-label={`Question ${index + 1}`}
                            value={question}
                            maxLength={MAX_LENGTH}
                            showCount
                            placeholder="e.g. What's good for dry skin in winter?"
                            error={
                              errors.questions[index] ||
                              serverErrors?.errors?.questions?.[index] ||
                              undefined
                            }
                            onChange={(value) => updateQuestion(index, value)}
                          />
                        </div>

                        <div className="sq-q__actions">
                          <button
                            type="button"
                            className="sq-test"
                            aria-label={`Test question ${index + 1}`}
                            disabled={!cleanText(question) || Boolean(errors.questions[index]) || (isTesting && testedIndex === index)}
                            onClick={() => testQuestion(index)}
                          >
                            <Icon name="sparkle" size={12} />
                            {isTesting && testedIndex === index ? "Testing…" : "Test"}
                          </button>
                          <span className="sq-q__divider" aria-hidden="true" />
                          <button
                            type="button"
                            className="sq-icon-btn"
                            aria-label={`Move question ${index + 1} up`}
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => moveQuestion(index, -1)}
                          >
                            <Icon name="arrowUp" size={13} />
                          </button>
                          <button
                            type="button"
                            className="sq-icon-btn"
                            aria-label={`Move question ${index + 1} down`}
                            title="Move down"
                            disabled={index === questions.length - 1}
                            onClick={() => moveQuestion(index, 1)}
                          >
                            <Icon name="arrowDown" size={13} />
                          </button>
                          <button
                            type="button"
                            className="sq-icon-btn"
                            aria-label={`Delete question ${index + 1}`}
                            title="Delete"
                            onClick={() => removeQuestion(index)}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </div>
                      </div>

                      {testedIndex === index && !isTesting && testResult && (
                        <div className="sq-result">
                          {testResult.success === false && (
                            <p className="ui-field-error">{testResult.message || "Search failed"}</p>
                          )}

                          {testResult.success === true && (
                            <>
                              <p className="sq-result__head">
                                Top results for &quot;{testedQuestion}&quot;
                                {testResult.message ? ` · ${testResult.message}` : ""}
                              </p>
                              {Array.isArray(testResult.products) && testResult.products.length > 0 ? (
                                <ol className="sq-result__list">
                                  {testResult.products.slice(0, 6).map((product, i) => (
                                    <li key={product.sku || i}>
                                      {product.title || "Untitled product"}
                                    </li>
                                  ))}
                                </ol>
                              ) : (
                                <p className="sq-result__empty">
                                  No products found. Try rewording this question.
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="sq-add"
                disabled={questions.length >= MAX_QUESTIONS}
                onClick={addQuestion}
              >
                <Icon name="plus" size={13} />
                Add question
              </button>
            </div>
          </li>

          {/* 3. Turn it on */}
          <li className="gr-step">
            <span className={`dash-num ${enabled ? "dash-tone--sage" : "dash-tone--teal"}`} aria-hidden="true">
              {enabled ? <Icon name="check" size={13} strokeWidth={2.4} /> : "3"}
            </span>
            <div className="gr-step__body">
              <span className="gr-step__title">Turn it on</span>
              <div className="gr-step__field">
                <Switch
                  label="Show questions in the search bar"
                  description={`Needs ${MIN_QUESTIONS}–${MAX_QUESTIONS} questions and the app embed turned on (see Dashboard).`}
                  checked={enabled}
                  onChange={setEnabled}
                />
              </div>
            </div>
          </li>
        </ol>

        {/* Save */}
        <div className="sq-save">
          <Button
            variant="primary"
            size="sm"
            loading={isSaving}
            disabled={!hasChanges || !valid}
            onClick={save}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
          {hasChanges && !isSaving ? (
            <span className="gr-unsaved">
              <span className="dash-pill__dot" aria-hidden="true" />
              Unsaved changes
            </span>
          ) : (
            !isSaving && <span className="ui-help">All changes saved.</span>
          )}
        </div>
      </section>
    </Page>
  );
}
