'use strict';
   
                                                                   
                                                  
   
const MAX_CELLS = 4_000_000;

function diffLines(a, b) {
  const A = a.split('\n');
  const B = b.split('\n');
  let start = 0;
  while (start < A.length && start < B.length && A[start] === B[start]) start++;
  let endA = A.length - 1;
  let endB = B.length - 1;
  while (endA >= start && endB >= start && A[endA] === B[endB]) { endA--; endB--; }

  const midA = A.slice(start, endA + 1);
  const midB = B.slice(start, endB + 1);
  const n = midA.length;
  const m = midB.length;
  const mid = [];

  if (n * m > MAX_CELLS) {
    for (const l of midA) mid.push({ t: '-', l });
    for (const l of midB) mid.push({ t: '+', l });
  } else {
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] = midA[i] === midB[j]
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { mid.push({ t: ' ', l: midA[i] }); i++; j++; }
      else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { mid.push({ t: '-', l: midA[i] }); i++; }
      else { mid.push({ t: '+', l: midB[j] }); j++; }
    }
    while (i < n) mid.push({ t: '-', l: midA[i++] });
    while (j < m) mid.push({ t: '+', l: midB[j++] });
  }

  return [
    ...A.slice(0, start).map((l) => ({ t: ' ', l })),
    ...mid,
    ...A.slice(endA + 1).map((l) => ({ t: ' ', l })),
  ];
}

function unifiedDiff(oldText, newText, fileName = 'file', context = 3) {
  const a = (oldText ?? '').replace(/\r\n/g, '\n');
  const b = (newText ?? '').replace(/\r\n/g, '\n');
  if (a === b) return { diff: '', added: 0, removed: 0 };
  const ops = diffLines(a, b);

  const oldNo = new Array(ops.length);
  const newNo = new Array(ops.length);
  let o = 0;
  let nw = 0;
  let added = 0;
  let removed = 0;
  ops.forEach((op, k) => {
    oldNo[k] = o;
    newNo[k] = nw;
    if (op.t !== '+') o++;
    if (op.t !== '-') nw++;
    if (op.t === '+') added++;
    if (op.t === '-') removed++;
  });

  const changes = [];
  ops.forEach((op, k) => { if (op.t !== ' ') changes.push(k); });

  const ranges = [];
  let i = 0;
  while (i < changes.length) {
    const s = changes[i];
    let e = s;
    while (i + 1 < changes.length && changes[i + 1] - e <= 2 * context + 1) { i++; e = changes[i]; }
    i++;
    ranges.push([Math.max(0, s - context), Math.min(ops.length - 1, e + context)]);
  }

  const out = [`--- a/${fileName}`, `+++ b/${fileName}`];
  for (const [hs, he] of ranges) {
    let oldLen = 0;
    let newLen = 0;
    for (let k = hs; k <= he; k++) {
      if (ops[k].t !== '+') oldLen++;
      if (ops[k].t !== '-') newLen++;
    }
    const oldStart = oldLen ? oldNo[hs] + 1 : oldNo[hs];
    const newStart = newLen ? newNo[hs] + 1 : newNo[hs];
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (let k = hs; k <= he; k++) out.push(ops[k].t + ops[k].l);
  }
  return { diff: out.join('\n'), added, removed };
}

module.exports = { diffLines, unifiedDiff };
