/**
 * Exact t-SNE (van der Maaten & Hinton, 2008) for projecting a small set of
 * high-dimensional vectors to 2D. O(n²) per iteration — fine for centroids.
 * shortcut: exact gradient, switch to Barnes-Hut if n grows past a few hundred points.
 */

export interface TSNEOptions {
  perplexity?: number
  iterations?: number
  seed?: number
}

// Deterministic PRNG so the layout doesn't jump between renders
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function computeTSNE(
  data: number[][],
  { perplexity = 30, iterations = 1000, seed = 42 }: TSNEOptions = {},
): [number, number][] | null {
  const n = data.length
  if (n < 2) return null

  // Pairwise squared distances
  const D = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0
      for (let k = 0; k < data[i].length; k++) {
        const diff = (data[i][k] ?? 0) - (data[j][k] ?? 0)
        s += diff * diff
      }
      D[i][j] = D[j][i] = s
    }
  }

  // Conditional probabilities via binary search on precision to match perplexity
  const perp = Math.min(perplexity, Math.max(1, (n - 1) / 3))
  const targetH = Math.log(perp)
  const P = Array.from({ length: n }, () => new Float64Array(n))
  for (let i = 0; i < n; i++) {
    let minD = Infinity
    for (let j = 0; j < n; j++) if (j !== i) minD = Math.min(minD, D[i][j])
    let beta = 1
    let lo = -Infinity
    let hi = Infinity
    for (let step = 0; step < 50; step++) {
      let sum = 0
      let sumDP = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        // Shift by minD so the nearest neighbour never underflows to 0
        const p = Math.exp(-(D[i][j] - minD) * beta)
        P[i][j] = p
        sum += p
        sumDP += (D[i][j] - minD) * p
      }
      const H = Math.log(sum) + (beta * sumDP) / sum
      for (let j = 0; j < n; j++) P[i][j] /= sum
      if (Math.abs(H - targetH) < 1e-5) break
      if (H > targetH) {
        lo = beta
        beta = hi === Infinity ? beta * 2 : (beta + hi) / 2
      } else {
        hi = beta
        beta = lo === -Infinity ? beta / 2 : (beta + lo) / 2
      }
    }
  }

  // Symmetrize joint probabilities
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = Math.max((P[i][j] + P[j][i]) / (2 * n), 1e-12)
      P[i][j] = P[j][i] = p
    }
  }

  // Gradient descent with momentum and adaptive gains
  const rand = mulberry32(seed)
  const Y = Array.from({ length: n }, () => [
    (rand() - 0.5) * 1e-2,
    (rand() - 0.5) * 1e-2,
  ])
  const vel = Array.from({ length: n }, () => [0, 0])
  const gains = Array.from({ length: n }, () => [1, 1])
  const lr = Math.max(n / 12, 10)
  const num = Array.from({ length: n }, () => new Float64Array(n))

  for (let iter = 0; iter < iterations; iter++) {
    const exaggeration = iter < 250 ? 4 : 1
    const momentum = iter < 250 ? 0.5 : 0.8

    let sumQ = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i][0] - Y[j][0]
        const dy = Y[i][1] - Y[j][1]
        const q = 1 / (1 + dx * dx + dy * dy)
        num[i][j] = num[j][i] = q
        sumQ += 2 * q
      }
    }

    // All gradients from the same Y before any point moves
    const grads = Y.map((yi, i) => {
      let gx = 0
      let gy = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const mult = 4 * (exaggeration * P[i][j] - num[i][j] / sumQ) * num[i][j]
        gx += mult * (yi[0] - Y[j][0])
        gy += mult * (yi[1] - Y[j][1])
      }
      return [gx, gy]
    })

    for (let i = 0; i < n; i++) {
      const g = grads[i]
      for (let d = 0; d < 2; d++) {
        gains[i][d] =
          Math.sign(g[d]) !== Math.sign(vel[i][d])
            ? gains[i][d] + 0.2
            : Math.max(gains[i][d] * 0.8, 0.01)
        vel[i][d] = momentum * vel[i][d] - lr * gains[i][d] * g[d]
        Y[i][d] += vel[i][d]
      }
    }

    // Re-center to keep the embedding around the origin
    let mx = 0
    let my = 0
    for (const y of Y) {
      mx += y[0]
      my += y[1]
    }
    for (const y of Y) {
      y[0] -= mx / n
      y[1] -= my / n
    }
  }

  return Y.map((y) => [y[0], y[1]])
}
