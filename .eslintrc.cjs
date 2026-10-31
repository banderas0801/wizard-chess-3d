module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  rules: {
    // Quy tắc chung
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  },
  overrides: [
    {
      // Logic cờ thuần TypeScript trong src/game/ tuyệt đối KHÔNG được import Three.js
      files: ['src/game/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'three',
                message: 'Module src/game/ la logic co thuan tuy, khong duoc phep import Three.js!'
              }
            ],
            patterns: [
              {
                group: ['three/*', 'three/**'],
                message: 'Module src/game/ khong duoc import bat ky thu vien do hoa Three.js nao!'
              }
            ]
          }
        ]
      }
    }
  ]
};
