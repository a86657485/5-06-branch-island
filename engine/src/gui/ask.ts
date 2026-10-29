import type { RpgPlayer } from '@rpgjs/server';

export interface DialogChoice {
  id: string;
  label: string;
}

export interface LessonDialogData {
  name: string;
  text: string;
  choices?: DialogChoice[];
  title?: string;
  hint?: string;
  program?: { condition: string; yes: string; no: string };
}

let dialogSequence = 0;

export async function ask(player: RpgPlayer, data: LessonDialogData): Promise<string | null> {
  const gui = player.gui('lesson-dialog');
  const response = await gui.open({ ...data, dialogId: ++dialogSequence }, { waitingAction: true, blockPlayerInput: true });
  if (typeof response !== 'string' || !data.choices?.some(choice => choice.id === response)) return null;
  return response;
}
