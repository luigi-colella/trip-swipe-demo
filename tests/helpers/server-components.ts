import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

type AsyncComponent = (props: unknown) => Promise<ReactNode>;

const isAsyncComponent = (type: unknown): type is AsyncComponent =>
  typeof type === "function" && type.constructor.name === "AsyncFunction";

/**
 * Resolves a Server Component tree for Testing Library: awaits promises (e.g. the
 * `params.then(...)` children of a Suspense boundary) and calls async Server Components,
 * leaving synchronous and Client Components for React to render as usual. Errors thrown by
 * the tree (redirect(), notFound()) propagate to the caller.
 */
export async function resolveServerTree(node: unknown): Promise<ReactNode> {
  const value = await node;
  if (Array.isArray(value)) return Promise.all(value.map(resolveServerTree));
  if (!isValidElement(value)) return value as ReactNode;
  const element = value as ReactElement<{ children?: unknown }>;
  if (isAsyncComponent(element.type)) {
    return resolveServerTree(await element.type(element.props));
  }
  if (element.props.children === undefined) return element;
  return cloneElement(element, { children: await resolveServerTree(element.props.children) });
}
