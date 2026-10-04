// 数据变更总线：台账/归档同次落库后发一个信号，当前打开的概览、台账页、归档页都按同一存储重算。
// 页面刷新与动作返回的结果因此永远一致——它们读的本来就是同一份刚落库的状态。
type Listener = () => void

const listeners = new Set<Listener>()

export function emitDataChange(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function onDataChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
