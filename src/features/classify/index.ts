/** Product kinds and categories chosen by the classifier and the members' overrides (05 §5.8). */

export type { ClassifyAnswer } from './model/classify';
export {
  createdCategorySource,
  fieldsFromAnswer,
  householdKinds,
  kindKey,
  kindOverrideCategory,
  propagateCategory,
} from './model/classify';
export { useAutoClassify } from './useAutoClassify';
