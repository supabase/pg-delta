/**
 * One graph, one deterministic sort (target-architecture §3.6).
 * Heap-based Kahn; a cycle throws with the full path — there is no repair
 * subsystem and never will be (guardrail 4).
 */

class MinHeap {
  #items: number[] = [];
  constructor(private readonly keyOf: (i: number) => string) {}

  get size(): number {
    return this.#items.length;
  }

  push(item: number): void {
    this.#items.push(item);
    let i = this.#items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (
        this.keyOf(this.#items[parent] as number) <=
        this.keyOf(this.#items[i] as number)
      )
        break;
      [this.#items[parent], this.#items[i]] = [
        this.#items[i] as number,
        this.#items[parent] as number,
      ];
      i = parent;
    }
  }

  pop(): number {
    const top = this.#items[0] as number;
    const last = this.#items.pop() as number;
    if (this.#items.length > 0) {
      this.#items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (
          l < this.#items.length &&
          this.keyOf(this.#items[l] as number) <
            this.keyOf(this.#items[smallest] as number)
        )
          smallest = l;
        if (
          r < this.#items.length &&
          this.keyOf(this.#items[r] as number) <
            this.keyOf(this.#items[smallest] as number)
        )
          smallest = r;
        if (smallest === i) break;
        [this.#items[smallest], this.#items[i]] = [
          this.#items[i] as number,
          this.#items[smallest] as number,
        ];
        i = smallest;
      }
    }
    return top;
  }
}

export function topoSort(
  nodeCount: number,
  edges: Array<[before: number, after: number]>,
  tieKeyOf: (node: number) => string,
  describe: (node: number) => string,
): number[] {
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  const indegree = Array.from({ length: nodeCount }, () => 0);
  const seen = new Set<string>();
  for (const [u, v] of edges) {
    if (u === v) continue;
    const key = `${u}>${v}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (adjacency[u] as number[]).push(v);
    indegree[v] = (indegree[v] as number) + 1;
  }

  const heap = new MinHeap(tieKeyOf);
  for (let i = 0; i < nodeCount; i++) if (indegree[i] === 0) heap.push(i);

  const order: number[] = [];
  while (heap.size > 0) {
    const node = heap.pop();
    order.push(node);
    for (const next of adjacency[node] as number[]) {
      indegree[next] = (indegree[next] as number) - 1;
      if (indegree[next] === 0) heap.push(next);
    }
  }

  if (order.length !== nodeCount) {
    // a cycle is a RULE BUG: report the cycle path, never repair (guardrail 4)
    const inCycle = new Set<number>();
    for (let i = 0; i < nodeCount; i++)
      if ((indegree[i] as number) > 0) inCycle.add(i);
    const cyclePath = [...inCycle].map(describe).join("\n  ");
    throw new Error(
      `dependency cycle among ${inCycle.size} actions — this is a rule/emission bug, fix the rule (guardrail 4):\n  ${cyclePath}`,
    );
  }
  return order;
}
