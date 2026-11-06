import { useState } from 'react';
import { useMediUi } from '../mediUi';
import { MediSheet } from './MediSheet';

/**
 * Mounts the one Medi sheet for the signed-in app. Nothing renders until the first open; after that
 * the sheet stays mounted so a closed-and-reopened chat keeps its messages for the session.
 */
export function MediHost() {
  const { open } = useMediUi();
  const [everOpened, setEverOpened] = useState(open);
  if (open && !everOpened) setEverOpened(true);
  return everOpened ? <MediSheet /> : null;
}
