// Built-in cover photos, drawn locally so they cost nothing and need no provider.
export const scenes = { valley: 'Green valley', sunrise: 'Golden sunrise', harbor: 'Harbor', road: 'Country road', bridge: 'River bridge', mountain: 'Mountain peak' } as const;
export type Scene = keyof typeof scenes;

export function drawScene(scene: Scene, width = 1200, height = 600): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(width / 800, height / 400);
  const water = scene === 'harbor' || scene === 'bridge';
  const dawn = scene === 'sunrise';
  const sky = ctx.createLinearGradient(0, 0, 0, 330);
  sky.addColorStop(0, dawn ? '#c87d80' : water ? '#8ab6c8' : '#a0c6bc');
  sky.addColorStop(1, dawn ? '#ffdc9c' : '#f3e7c9');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 800, 400);
  const polygon = (color: string, points: [number, number][]) => {
    ctx.fillStyle = color; ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fill();
  };
  ctx.fillStyle = dawn ? '#fff2a8' : '#fff2d4';
  ctx.beginPath(); ctx.arc(dawn ? 400 : 650, dawn ? 173 : 83, dawn ? 86 : 35, 0, Math.PI * 2); ctx.fill();
  polygon('#879d99', [[0, 208], [140, 134], [235, 190], [395, 95], [531, 182], [670, 125], [800, 198], [800, 400], [0, 400]]);
  if (scene === 'mountain') {
    polygon('#475e67', [[90, 311], [424, 42], [707, 295]]);
    polygon('#f4f0db', [[323, 124], [424, 42], [514, 123], [455, 99], [430, 120], [403, 98], [382, 116]]);
  }
  polygon('#678b7b', [[0, 209], [126, 234], [245, 188], [402, 238], [583, 186], [800, 239], [800, 400], [0, 400]]);
  polygon(water ? '#527f91' : '#416956', [[0, 276], [212, 253], [397, 265], [600, 231], [800, 254], [800, 400], [0, 400]]);
  if (scene === 'road') polygon('#d3aa78', [[389, 260], [416, 260], [368, 289], [462, 325], [559, 400], [361, 400], [360, 344], [296, 308]]);
  if (scene === 'bridge') {
    ctx.strokeStyle = '#714837'; ctx.lineWidth = 8;
    for (const x of [130, 650]) { ctx.beginPath(); ctx.moveTo(x, 165); ctx.lineTo(x, 300); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, 236); ctx.lineTo(130, 168); ctx.quadraticCurveTo(390, 310, 650, 168); ctx.lineTo(800, 235); ctx.stroke();
    ctx.fillStyle = '#644739'; ctx.fillRect(0, 249, 800, 10);
  }
  if (scene === 'harbor') {
    polygon('#ffebc2', [[440, 147], [440, 295], [347, 295]]);
    polygon('#c86d48', [[450, 182], [450, 295], [513, 295]]);
    polygon('#233f4a', [[335, 302], [529, 302], [504, 323], [363, 323]]);
  }
  return canvas;
}
