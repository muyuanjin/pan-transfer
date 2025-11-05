import type { PanelDomRefs } from '../../../types'
import type { TransferController } from '../../transfer/transfer-controller'
import type { Binder } from './types'

interface TransferBinderDeps {
  panelDom: PanelDomRefs
  transfer: TransferController
}

export function createTransferBinder({ panelDom, transfer }: TransferBinderDeps): Binder {
  return {
    bind(): () => void {
      const button = panelDom.transferBtn
      if (!button) {
        return () => {}
      }
      const handleClick = () => {
        void transfer.handleTransfer()
      }
      button.addEventListener('click', handleClick)
      return () => {
        button.removeEventListener('click', handleClick)
      }
    },
  }
}
