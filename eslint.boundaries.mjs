// Architecture and security guardrails shared by all apps (requirements/08 §6, §8).
// Changing these rules weakens security controls: requires human approval (H7).

/** @type {import("eslint").Linter.Config[]} */
const boundaries = [
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "firebase-admin",
              message: "Use @crm/core (server-only). The Admin SDK bypasses Security Rules.",
            },
          ],
          patterns: [
            {
              group: ["firebase-admin/*"],
              message: "Use @crm/core (server-only). The Admin SDK bypasses Security Rules.",
            },
            {
              group: ["@crm/*/src/*", "**/packages/*/src/*"],
              message:
                "Import workspace packages through their package exports (e.g. @crm/ui/components/button).",
            },
          ],
        },
      ],
      // Untrusted HTML must go through the sanitized SafeMarkdown component (04 §8).
      "react/no-danger": "error",
    },
  },
];

export default boundaries;
