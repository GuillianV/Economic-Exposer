import js from "@eslint/js";
import importPlugin from "eslint-plugin-import";
import jsdoc from "eslint-plugin-jsdoc";
import globals from "globals";

/**
 * Garde-fou mécanique des conventions CLAUDE.md :
 *   - JSDoc obligatoire (rôle + @param + @returns) sur chaque fonction/méthode
 *   - jamais de console.log (logger uniquement) — sauf harnais CLI (src/*.mjs)
 *   - zéro nombre magique (constantes nommées)
 *   - pas de ternaires imbriqués, pas de var, pas de ==, pas de réassignation
 *     d'argument (la mutation de propriétés documentée @mutates reste permise)
 *   - imports triés (natifs Node, puis externes, puis internes) sans doublon
 */

export default [
  js.configs.recommended,
  jsdoc.configs["flat/recommended"],
  {
    files: ["src/**/*.js", "src/**/*.mjs", "scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    plugins: { import: importPlugin },
    settings: {
      jsdoc: { mode: "jsdoc" },
    },
    rules: {
      "no-console": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-nested-ternary": "error",
      "no-param-reassign": ["error", { props: false }],
      // no-magic-numbers VOLONTAIREMENT absent : la règle flag les sites de
      // définition des constantes composées (30 * 60 * 1000, 365 * DAY_MS) que
      // la convention impose justement — le zéro-nombre-magique reste tenu en
      // review, pas ici.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],

      "import/order": [
        "error",
        {
          groups: [["builtin"], ["external"], ["internal", "parent", "sibling", "index"]],
          alphabetize: { order: "asc", caseInsensitive: true },
          "newlines-between": "never",
        },
      ],
      "import/no-duplicates": "error",

      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            FunctionExpression: false,
            ArrowFunctionExpression: false,
          },
        },
      ],
      "jsdoc/require-description": "error",
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": ["error", { exemptedBy: ["returns", "mutates"] }],
      "jsdoc/require-returns-description": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": ["error", { definedTags: ["mutates"] }],
      "jsdoc/no-undefined-types": "off",
      "jsdoc/require-param-type": "error",
      "jsdoc/require-returns-type": "error",
      "jsdoc/tag-lines": "off",
      // {*} et {Function} sont des types LÉGITIMES ici : parseurs tolérants
      // (toFiniteNumber, parseJsonLoose) et fabriques de middlewares/stop.
      "jsdoc/reject-any-type": "off",
      "jsdoc/reject-function-type": "off",
    },
  },
  {
    // Harnais CLI : la sortie stdout est le produit (fa:ai imprime du JSON pur).
    files: ["src/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];
