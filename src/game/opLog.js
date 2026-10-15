/**
 * Кольцевой буфер последних операций (ring buffer).
 * Нужен для дельт при переподключении: если lastSeq клиента
 * в пределах буфера — отдаём дельту, иначе клиент запросит снапшот.
 */
export class OpLog {
  constructor(size = 5000) {
    if (!Number.isInteger(size) || size <= 0) throw new Error("OpLog size must be positive");
    this.size = size;
    this.buf = new Array(size);
    this.writeIdx = 0;
    this.count = 0;
  }

  push(op) {
    this.buf[this.writeIdx] = op;
    this.writeIdx = (this.writeIdx + 1) % this.size;
    this.count += 1;
  }

  get firstSeq() {
    if (this.count === 0) return null;
    const oldestIdx = this.count <= this.size ? 0 : this.writeIdx;
    return this.buf[oldestIdx].seq;
  }

  get lastSeq() {
    if (this.count === 0) return null;
    return this.buf[(this.writeIdx - 1 + this.size) % this.size].seq;
  }

  entries() {
    if (this.count === 0) return [];
    const n = Math.min(this.count, this.size);
    const start = this.count <= this.size ? 0 : this.writeIdx;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.buf[(start + i) % this.size];
    return out;
  }

  /**
   * Операции с seq > lastSeq, в порядке возрастания.
   * Возвращает null, если lastSeq устарел (клиенту нужен снапшот).
   */
  fromSeq(lastSeq) {
    if (this.count === 0) return [];
    if (lastSeq === null || lastSeq === undefined || !Number.isInteger(lastSeq)) return null;
    if (lastSeq < this.firstSeq) return null;
    return this.entries().filter((op) => op.seq > lastSeq);
  }
}