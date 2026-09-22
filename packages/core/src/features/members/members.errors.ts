/** members 功能特有的错误定义 */

import { domainError, type DomainError } from '@recado/shared';

export type MemberError = DomainError<'NOT_FOUND_MEMBER'>;

export const MemberErrors = {
  notFound: (id: string) => domainError('NOT_FOUND_MEMBER', 'Member not found', { id }),
} as const;
