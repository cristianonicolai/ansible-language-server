import { Hover, MarkupContent, MarkupKind } from 'vscode-languageserver';
import { Position, TextDocument } from 'vscode-languageserver-textdocument';
import { parseAllDocuments } from 'yaml';
import { Scalar, YAMLMap } from 'yaml/types';
import { DocsLibrary } from '../services/docsLibrary';
import {
  blockKeywords,
  isTaskKeyword,
  playKeywords,
  roleKeywords,
  taskKeywords,
} from '../utils/ansible';
import {
  formatModule,
  formatOption,
  formatTombstone,
} from '../utils/docsFormatter';
import { toLspRange } from '../utils/misc';
import {
  AncestryBuilder,
  findProvidedModule,
  getPathAt,
  isBlockParam,
  isPlayParam,
  isRoleParam,
  isTaskParam,
} from '../utils/yaml';

export async function doHover(
  document: TextDocument,
  position: Position,
  docsLibrary: DocsLibrary
): Promise<Hover | null> {
  const yamlDocs = parseAllDocuments(document.getText());
  const path = getPathAt(document, position, yamlDocs);
  if (path) {
    const node = path[path.length - 1];
    if (
      node instanceof Scalar &&
      new AncestryBuilder(path).parentOfKey().get() // ensure we look at a key, not value of a Pair
    ) {
      if (isPlayParam(path)) {
        return getKeywordHover(document, node, playKeywords);
      }

      if (isBlockParam(path)) {
        return getKeywordHover(document, node, blockKeywords);
      }

      if (isRoleParam(path)) {
        return getKeywordHover(document, node, roleKeywords);
      }

      if (isTaskParam(path)) {
        if (isTaskKeyword(node.value)) {
          return getKeywordHover(document, node, taskKeywords);
        } else {
          const [module, hitFqcn] = await docsLibrary.findModule(
            node.value,
            path,
            document.uri
          );
          if (module && module.documentation) {
            return {
              contents: formatModule(
                module.documentation,
                docsLibrary.getModuleRoute(hitFqcn || node.value)
              ),
              range: node.range ? toLspRange(node.range, document) : undefined,
            };
          } else if (hitFqcn) {
            // check for tombstones
            const route = docsLibrary.getModuleRoute(hitFqcn);
            if (route) {
              return {
                contents: formatTombstone(route),
                range: node.range
                  ? toLspRange(node.range, document)
                  : undefined,
              };
            }
          }
        }
      }

      // hovering over a module parameter
      // can either be directly under module or in 'args'
      const parentKeyPath = new AncestryBuilder(path)
        .parentOfKey()
        .parent(YAMLMap)
        .getKeyPath();

      if (parentKeyPath && isTaskParam(parentKeyPath)) {
        const parentKeyNode = parentKeyPath[parentKeyPath.length - 1];
        if (parentKeyNode instanceof Scalar) {
          let module;
          if (parentKeyNode.value === 'args') {
            module = await findProvidedModule(
              parentKeyPath,
              document,
              docsLibrary
            );
          } else {
            [module] = await docsLibrary.findModule(
              parentKeyNode.value,
              parentKeyPath,
              document.uri
            );
          }
          if (module && module.documentation) {
            const option = module.documentation.options.get(node.value);
            if (option) {
              return {
                contents: formatOption(option, true),
              };
            }
          }
        }
      }
    }
  }
  return null;
}

function getKeywordHover(
  document: TextDocument,
  node: Scalar,
  keywords: Map<string, string | MarkupContent>
): Hover | null {
  const keywordDocumentation = keywords.get(node.value);
  const markupDoc =
    typeof keywordDocumentation === 'string'
      ? {
          kind: MarkupKind.Markdown,
          value: keywordDocumentation,
        }
      : keywordDocumentation;
  if (markupDoc) {
    return {
      contents: markupDoc,
      range: node.range ? toLspRange(node.range, document) : undefined,
    };
  } else return null;
}