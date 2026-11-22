import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CORE_FORBIDDEN_DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'location',
  'history',
  'HTMLElement',
  'HTMLCanvasElement',
  'CanvasRenderingContext2D',
  'OffscreenCanvas',
  'SVGElement',
  'Element',
  'Node',
  'Event',
  'CustomEvent',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'TouchEvent',
  'WheelEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'matchMedia',
  'ResizeObserver',
  'IntersectionObserver',
  'MutationObserver',
].map((name) => ({
  name,
  message:
    'src/core/ must remain DOM-free so every correctness property runs in Node (Requirement 17.7).',
}));

export default tseslint.config(
  {
    ignores: [
      '.agent/**',
      '.kiro/**',
      '.next/**',
      '.next-*/**',
      'out/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'tools/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^NEXT_PUBLIC_LLM/]',
          message:
            'LLM provider keys and config must remain server-only without a NEXT_PUBLIC_ prefix (Requirement 16.4).',
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.nodeBuiltin,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'src/core/ is framework-free: React imports are forbidden (Requirement 17.7).',
            },
            {
              name: 'react-dom',
              message:
                'src/core/ is framework-free: React DOM imports are forbidden (Requirement 17.7).',
            },
            {
              name: 'next',
              message:
                'src/core/ is framework-free: Next.js imports are forbidden (Requirement 17.7).',
            },
            {
              name: 'zustand',
              message:
                'src/core/ is framework-free: UI state stores belong in src/ui/state/ (Requirement 17.7).',
            },
            {
              name: 'sonner',
              message:
                'src/core/ is framework-free: UI toast imports are forbidden (Requirement 17.7).',
            },
            {
              name: 'cmdk',
              message:
                'src/core/ is framework-free: command palette UI belongs in src/ui/ (Requirement 17.7).',
            },
            {
              name: 'motion',
              message:
                'src/core/ is framework-free: animation imports belong in src/ui/ (Requirement 17.7).',
            },
            {
              name: 'lucide-react',
              message:
                'src/core/ is framework-free: icon imports belong in src/ui/ (Requirement 17.7).',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', '@types/react', '@types/react/*'],
              message:
                'src/core/ is framework-free: React imports are forbidden (Requirement 17.7).',
            },
            {
              group: ['next/*', '@next/*'],
              message:
                'src/core/ is framework-free: Next.js imports are forbidden (Requirement 17.7).',
            },
            {
              group: [
                '@/ui',
                '@/ui/*',
                '@/app',
                '@/app/*',
                '@/workers',
                '@/workers/*',
                '../ui/*',
                '../../ui/*',
                '../../../ui/*',
                '../app/*',
                '../../app/*',
                '../../../app/*',
                '../workers/*',
                '../../workers/*',
                '../../../workers/*',
              ],
              message:
                'src/core/ must not import from src/ui/, src/app/, or src/workers/ (Requirement 17.7).',
            },
            {
              group: ['@radix-ui/*', '@visx/*', 'motion/*'],
              message:
                'src/core/ must not import UI or DOM rendering libraries (Requirement 17.7).',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...CORE_FORBIDDEN_DOM_GLOBALS],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^NEXT_PUBLIC_LLM/]',
          message:
            'LLM provider keys and config must remain server-only without a NEXT_PUBLIC_ prefix (Requirement 16.4).',
        },
        {
          selector: 'JSXElement, JSXFragment',
          message: 'JSX syntax is forbidden inside src/core/ (Requirement 17.7).',
        },
      ],
    },
  },
);
