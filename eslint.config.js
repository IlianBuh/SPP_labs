import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["node_modules/", "public/", "data/"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
  },
];