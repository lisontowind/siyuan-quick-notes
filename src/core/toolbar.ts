export const toolbarActions = ['bold', 'italic', 'underline', 'strike', 'heading', 'unordered', 'ordered', 'task', 'quote', 'code', 'link', 'image'] as const;
export type ToolbarAction = typeof toolbarActions[number];
export interface ToolbarLayout { order: ToolbarAction[] }
export function validToolbarLayout(value: unknown): value is ToolbarLayout {
  const order = (value as ToolbarLayout | undefined)?.order;
  return Array.isArray(order) && order.length === toolbarActions.length && new Set(order).size === order.length
    && order.every(id => toolbarActions.includes(id));
}
export function parseToolbarLayout(value: unknown): ToolbarLayout {
  return { order: validToolbarLayout(value) ? [...value.order] : [...toolbarActions] };
}
export function toolbarCapacity(width: number, count = toolbarActions.length): number {
  return Math.max(0, Math.min(count, Math.floor((width - 16 - 30) / 30)));
}
export function moveToolbarAction(order: readonly ToolbarAction[], from: ToolbarAction, to: ToolbarAction): ToolbarAction[] {
  const result = [...order], start = result.indexOf(from), end = result.indexOf(to);
  if (start >= 0 && end >= 0) result.splice(end, 0, ...result.splice(start, 1));
  return result;
}
