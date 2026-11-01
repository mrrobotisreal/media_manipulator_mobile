import type { ResultContext } from '@/analytics/resultEvents';
import type { ResultDescriptor } from '../describe';

export interface ViewerProps {
  descriptor: ResultDescriptor;
  context: ResultContext;
}
