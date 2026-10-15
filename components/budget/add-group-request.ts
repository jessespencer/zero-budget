// The "Add category group" dialog lives in BudgetTable, which owns its undo
// entry and failure toast. Siblings on the budget page (the setup checklist)
// ask it to open through this event rather than mounting a second copy.
const ADD_GROUP_EVENT = "zero:add-category-group";

export function requestAddCategoryGroup(): void {
  window.dispatchEvent(new Event(ADD_GROUP_EVENT));
}

export function onAddCategoryGroupRequest(handler: () => void): () => void {
  window.addEventListener(ADD_GROUP_EVENT, handler);
  return () => window.removeEventListener(ADD_GROUP_EVENT, handler);
}
