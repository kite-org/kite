/**
 * Vite plugin to control Monaco Editor bundle size.
 *
 * Monaco's `basic-languages/_.contribution.js` (and every language file such as
 * `yaml.js`) unconditionally import ALL editor contrib features as side-effects.
 * This plugin strips the unwanted imports and keeps only the features you list,
 * similar to `monaco-editor-webpack-plugin`'s `features` option.
 *
 * Usage:
 *   monacoEditorFeatures({ features: ['find', 'folding', 'clipboard', ...] })
 */
import type { Plugin } from 'vite'

export interface MonacoEditorFeaturesOptions {
  /**
   * Editor contrib features to keep.
   * Names correspond to the folder name under `vs/editor/contrib/`, e.g.
   * `'find'`, `'folding'`, `'clipboard'`, `'comment'`.
   *
   * The following are always included regardless of this list:
   * - core commands & widgets (coreCommands, codeEditorWidget, diffEditor)
   * - codicon CSS
   * - standaloneStrings
   *
   * If omitted or empty, **all** features are kept (no stripping).
   */
  features?: string[]
}

const MONACO_LANG_RE = /monaco-editor[\\/]esm[\\/]vs[\\/]basic-languages[\\/]/

export default function monacoEditorFeatures(
  options: MonacoEditorFeaturesOptions = {}
): Plugin {
  const { features } = options

  if (!features || features.length === 0) {
    return { name: 'monaco-editor-features' }
  }

  const featureSet = new Set(features)

  return {
    name: 'monaco-editor-features',

    transform(code, id) {
      if (!MONACO_LANG_RE.test(id.replaceAll('\\', '/'))) return null

      const lines = code.split('\n')
      const kept: string[] = []

      for (const line of lines) {
        if (!isBareImport(line)) {
          kept.push(line)
          continue
        }

        const specifier = extractSpecifier(line)
        if (!specifier) {
          kept.push(line)
          continue
        }

        if (isAlwaysKept(specifier)) {
          kept.push(line)
          continue
        }

        const feature = contribName(specifier)
        if (feature && featureSet.has(feature)) {
          kept.push(line)
          continue
        }

        // Drop this import (contrib we don't need, or standalone helper we don't need)
      }

      return kept.join('\n')
    },
  }
}

/** Detect side-effect-only import statements: `import '...'` / `import "..."` */
function isBareImport(line: string): boolean {
  const t = line.trim()
  return (
    (t.startsWith("import '") || t.startsWith('import "')) &&
    !t.includes(' from ')
  )
}

/** Pull the specifier string out of `import '...'` */
function extractSpecifier(line: string): string | null {
  const m = line.match(/import\s+['"]([^'"]+)['"]/)
  return m ? m[1] : null
}

/** Imports that must always be present for the editor to work at all. */
function isAlwaysKept(specifier: string): boolean {
  return (
    specifier.includes('coreCommands') ||
    specifier.includes('codeEditorWidget') ||
    specifier.includes('diffEditor.contribution') ||
    specifier.includes('standaloneStrings') ||
    specifier.endsWith('.css')
  )
}

/** Extract the contrib feature name from paths like `../editor/contrib/find/browser/findController.js` */
function contribName(specifier: string): string | null {
  const m = specifier.match(/editor\/contrib\/([^/]+)\//)
  return m ? m[1] : null
}
