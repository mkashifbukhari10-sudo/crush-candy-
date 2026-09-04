/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
      rules: {
        // These packages expose ESM subpaths that eslint's Node resolver does
        // not understand. TypeScript and the production build still verify them.
        "import/no-unresolved": [
          "error",
          {
            ignore: [
              "^@shopify/shopify-app-react-router/(adapters/node|react|server)$",
              "^@react-router/dev/vite$",
            ],
          },
        ],
      },
    },

    // Trust-plane import boundaries. Future plane routes inherit these rules.
    {
      files: [
        "app/routes/app*.{ts,tsx}",
        "app/auth/admin.server.ts",
        "app/services/admin/**/*.{ts,tsx}",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/auth/customer.server",
                  "**/auth/driver.server",
                  "**/services/customer/**",
                  "**/services/driver/**",
                ],
                message: "Admin-plane code cannot import customer or driver plane code.",
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        "app/routes/apps.portal*.{ts,tsx}",
        "app/auth/customer.server.ts",
        "app/services/customer/**/*.{ts,tsx}",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/auth/admin.server",
                  "**/auth/driver.server",
                  "**/services/admin/**",
                  "**/services/driver/**",
                ],
                message: "Customer-plane code cannot import admin or driver plane code.",
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        "app/routes/driver*.{ts,tsx}",
        "app/auth/driver.server.ts",
        "app/services/driver/**/*.{ts,tsx}",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/auth/admin.server",
                  "**/auth/customer.server",
                  "**/services/admin/**",
                  "**/services/customer/**",
                ],
                message: "Driver-plane code cannot import admin or customer plane code.",
              },
            ],
          },
        ],
      },
    },

    // Node
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
      ],
      env: {
        node: true,
      },
    },
  ],
  globals: {
    shopify: "readonly"
  },
};
