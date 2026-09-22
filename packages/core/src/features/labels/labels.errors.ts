/** labels 功能特有的错误定义 */

import { domainError, type DomainError } from '@recado/shared';

export type LabelError =
  | DomainError<'NOT_FOUND_LABEL'>
  | DomainError<'CONFLICT_LABEL_NAME_TAKEN'>
  | DomainError<'VALIDATION_LABEL_NAME_REQUIRED'>;

export const LabelErrors = {
  notFound: (id: string) => domainError('NOT_FOUND_LABEL', 'Label not found', { id }),

  nameTaken: (name: string) =>
    domainError('CONFLICT_LABEL_NAME_TAKEN', 'A label with this name already exists', { name }),

  nameRequired: () => domainError('VALIDATION_LABEL_NAME_REQUIRED', 'Label name is required'),
} as const;
