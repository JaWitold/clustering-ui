/**
 * Principal Component Analysis (PCA) for projecting high-dimensional vectors to 2D
 */

export interface PCAResult {
  project: (vector: number[]) => [number, number]
  explainedVarianceRatio: [number, number]
  totalVariance: number
  pc1Coefficients: number[]
  pc2Coefficients: number[]
}

/**
 * Computes PCA on an array of D-dimensional vectors
 */
export function computePCA(data: number[][]): PCAResult | null {
  if (!data || data.length < 2) return null
  const n = data.length
  const d = data[0].length
  if (d < 2) return null

  // 1. Compute mean for each feature
  const mean: number[] = new Array(d).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      mean[j] += data[i][j]
    }
  }
  for (let j = 0; j < d; j++) {
    mean[j] /= n
  }

  // 2. Center the data
  const centered: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(d)
    for (let j = 0; j < d; j++) {
      row[j] = data[i][j] - mean[j]
    }
    centered.push(row)
  }

  // 3. Compute sample covariance matrix C (d x d)
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0))
  const denom = n > 1 ? n - 1 : 1
  for (let i = 0; i < d; i++) {
    for (let j = i; j < d; j++) {
      let sum = 0
      for (let k = 0; k < n; k++) {
        sum += centered[k][i] * centered[k][j]
      }
      cov[i][j] = sum / denom
      cov[j][i] = cov[i][j]
    }
  }

  // 4. Jacobi eigenvalue algorithm for symmetric matrix
  const V: number[][] = Array.from({ length: d }, (_, i) => {
    const row = new Array(d).fill(0)
    row[i] = 1
    return row
  })
  const A = cov.map((row) => [...row])

  const maxIter = 100
  for (let iter = 0; iter < maxIter; iter++) {
    // Find largest off-diagonal element
    let maxOffDiag = 0
    let p = 0
    let q = 1
    for (let i = 0; i < d; i++) {
      for (let j = i + 1; j < d; j++) {
        if (Math.abs(A[i][j]) > maxOffDiag) {
          maxOffDiag = Math.abs(A[i][j])
          p = i
          q = j
        }
      }
    }

    if (maxOffDiag < 1e-9) break

    // Compute rotation angle
    const theta = (A[q][q] - A[p][p]) / (2 * A[p][q])
    let t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(1 + theta * theta))
    if (isNaN(t) || !isFinite(t)) t = 0
    const c = 1 / Math.sqrt(1 + t * t)
    const s = t * c

    // Rotate matrix A
    const app = A[p][p]
    const aqq = A[q][q]
    const apq = A[p][q]
    A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq
    A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq
    A[p][q] = 0
    A[q][p] = 0

    for (let i = 0; i < d; i++) {
      if (i !== p && i !== q) {
        const aip = A[i][p]
        const aiq = A[i][q]
        A[i][p] = c * aip - s * aiq
        A[p][i] = A[i][p]
        A[i][q] = s * aip + c * aiq
        A[q][i] = A[i][q]
      }
    }

    // Accumulate eigenvectors in V
    for (let i = 0; i < d; i++) {
      const vip = V[i][p]
      const viq = V[i][q]
      V[i][p] = c * vip - s * viq
      V[i][q] = s * vip + c * viq
    }
  }

  // Extract eigenvalues (diagonal of A) and corresponding eigenvectors (columns of V)
  const eigenPairs: { val: number; vec: number[] }[] = []
  for (let i = 0; i < d; i++) {
    const val = Math.max(0, A[i][i])
    const vec: number[] = new Array(d)
    for (let j = 0; j < d; j++) {
      vec[j] = V[j][i]
    }
    eigenPairs.push({ val, vec })
  }

  // Sort descending by eigenvalue
  eigenPairs.sort((a, b) => b.val - a.val)

  const totalVariance = eigenPairs.reduce((acc, p) => acc + p.val, 0)
  const safeTotal = totalVariance > 1e-9 ? totalVariance : 1

  const pc1 = eigenPairs[0].vec
  const pc2 = eigenPairs[1]?.vec || new Array(d).fill(0)
  const varRatio1 = eigenPairs[0].val / safeTotal
  const varRatio2 = (eigenPairs[1]?.val || 0) / safeTotal

  const project = (v: number[]): [number, number] => {
    let x = 0
    let y = 0
    for (let i = 0; i < d; i++) {
      const diff = (v[i] ?? 0) - mean[i]
      x += diff * pc1[i]
      y += diff * pc2[i]
    }
    return [x, y]
  }

  return {
    project,
    explainedVarianceRatio: [varRatio1, varRatio2],
    totalVariance,
    pc1Coefficients: pc1,
    pc2Coefficients: pc2,
  }
}
