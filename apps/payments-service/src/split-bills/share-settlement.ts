import { EntityManager } from 'typeorm';
import { Transfer } from '../transfers/entities/transfer.entity';
import { SplitShare } from './entities/split-share.entity';

// Фінал переказу-оплати частки: COMPLETED → PAID, FAILED → знову ACCEPTED
// (учасник може заплатити ще раз). Викликається в тій самій транзакції, що
// й фінальний статус переказу. Умова status = PAYING робить перехід
// безпечним до повтору.
export async function settleSplitShare(
  manager: EntityManager,
  transfer: Transfer,
): Promise<void> {
  if (!transfer.splitShareId) return;
  if (transfer.status === 'COMPLETED') {
    await manager.update(
      SplitShare,
      { id: transfer.splitShareId, status: 'PAYING' },
      { status: 'PAID' },
    );
  } else if (transfer.status === 'FAILED') {
    await manager.update(
      SplitShare,
      { id: transfer.splitShareId, status: 'PAYING' },
      { status: 'ACCEPTED' },
    );
  }
}
