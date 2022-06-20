const express = require("express");
const bodyParser = require("body-parser");
const cors = require('cors')
const { createCanvas, loadImage } = require('canvas')
const app = express();
app.use(cors());
//Here we are configuring express to use body-parser as middle-ware.
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ limit: '50mb' }));

app.post('/drawCanvas', (request,response) => {
  let triangulation = request.body.triangulation;
  let pixelRatio = request.body.pixelRatio;
  let targetTopLeft = request.body.targetTopLeft;
  let targetResolution = request.body.targetResolution; 
  let canvasAsUrl = request.body.canvasAsUrl; 
  let sourceDataExtent = request.body.sourceDataExtent; 
  let opt_interpolate  = request.body.opt_interpolate; 
  let sourceResolution = request.body.sourceResolution; 
  let stitchCanvasAsUrl = request.body.stitchCanvasAsUrl; 
  let opt_renderEdges = request.body.opt_renderEdges;
  let canvasSize = request.body.canvasSize;
  let stitchCanvasSize = request.body.stitchCanvasSize;
  
  let context = createCanvas(canvasSize.width, canvasSize.height).getContext('2d');
  context.fillStyle = "red";
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  let stitchContext = createCanvas(stitchCanvasSize.width, stitchCanvasSize.height).getContext('2d');
  
  loadImage(canvasAsUrl).then((image) => {
    context.drawImage(image, 0, 0);

    loadImage(stitchCanvasAsUrl).then((stitchImage) => {
      stitchContext.drawImage(stitchImage, 0, 0);
      drawTile();
   
			function drawTile() {
				function pixelRound(value) {
					return Math.round(value * pixelRatio) / pixelRatio;
				}

				triangulation.triangles_.forEach(function (triangle, i, arr) {
					/* Calculate affine transform (src -> dst)
					* Resulting matrix can be used to transform coordinate
					* from `sourceProjection` to destination pixels.
					*
					* To optimize number of context calls and increase numerical stability,
					* we also do the following operations:
					* trans(-topLeftExtentCorner), scale(1 / targetResolution), scale(1, -1)
					* here before solving the linear system so [ui, vi] are pixel coordinates.
					*
					* Src points: xi, yi
					* Dst points: ui, vi
					* Affine coefficients: aij
					*
					* | x0 y0 1  0  0 0 |   |a00|   |u0|
					* | x1 y1 1  0  0 0 |   |a01|   |u1|
					* | x2 y2 1  0  0 0 | x |a02| = |u2|
					* |  0  0 0 x0 y0 1 |   |a10|   |v0|
					* |  0  0 0 x1 y1 1 |   |a11|   |v1|
					* |  0  0 0 x2 y2 1 |   |a12|   |v2|
					*/
					const source = triangle.source;
					const target = triangle.target;
					let x0 = source[0][0],
					y0 = source[0][1];
					let x1 = source[1][0],
					y1 = source[1][1];
					let x2 = source[2][0],
					y2 = source[2][1];
					// Make sure that everything is on pixel boundaries
					const u0 = pixelRound((target[0][0] - targetTopLeft[0]) / targetResolution);
					const v0 = pixelRound(
					-(target[0][1] - targetTopLeft[1]) / targetResolution
					);
					const u1 = pixelRound((target[1][0] - targetTopLeft[0]) / targetResolution);
					const v1 = pixelRound(
					-(target[1][1] - targetTopLeft[1]) / targetResolution
					);
					const u2 = pixelRound((target[2][0] - targetTopLeft[0]) / targetResolution);
					const v2 = pixelRound(
					-(target[2][1] - targetTopLeft[1]) / targetResolution
					);
				
					// Shift all the source points to improve numerical stability
					// of all the subsequent calculations. The [x0, y0] is used here.
					// This is also used to simplify the linear system.
					const sourceNumericalShiftX = x0;
					const sourceNumericalShiftY = y0;
					x0 = 0;
					y0 = 0;
					x1 -= sourceNumericalShiftX;
					y1 -= sourceNumericalShiftY;
					x2 -= sourceNumericalShiftX;
					y2 -= sourceNumericalShiftY;
				
					const augmentedMatrix = [
					[x1, y1, 0, 0, u1 - u0],
					[x2, y2, 0, 0, u2 - u0],
					[0, 0, x1, y1, v1 - v0],
					[0, 0, x2, y2, v2 - v0],
					];
					const affineCoefs = solveLinearSystem(augmentedMatrix);
					
					if (!affineCoefs) {
						return;
					}
				
					context.save();
					context.beginPath();
					context.moveTo(u1, v1);
					context.lineTo(u0, v0);
					context.lineTo(u2, v2);
					context.clip();
				
					context.transform(
					affineCoefs[0],
					affineCoefs[2],
					affineCoefs[1],
					affineCoefs[3],
					u0,
					v0
					);
				
					context.translate(
					sourceDataExtent[0] - sourceNumericalShiftX,
					sourceDataExtent[3] - sourceNumericalShiftY
					);
				
					context.scale(
					sourceResolution / pixelRatio,
					-sourceResolution / pixelRatio
					);
				
					context.drawImage(stitchContext.canvas, 0, 0);
					context.restore();
				});
		
				response.send(context.canvas.toDataURL());
			}
		})
	})	
})

function solveLinearSystem(mat) {
	const n = mat.length;

	for (let i = 0; i < n; i++) {
		// Find max in the i-th column (ignoring i - 1 first rows)
		let maxRow = i;
		let maxEl = Math.abs(mat[i][i]);
		for (let r = i + 1; r < n; r++) {
			const absValue = Math.abs(mat[r][i]);
			if (absValue > maxEl) {
				maxEl = absValue;
				maxRow = r;
			}
		}

		if (maxEl === 0) {
			return null; // matrix is singular
		}

		// Swap max row with i-th (current) row
		const tmp = mat[maxRow];
		mat[maxRow] = mat[i];
		mat[i] = tmp;

		// Subtract the i-th row to make all the remaining rows 0 in the i-th column
		for (let j = i + 1; j < n; j++) {
			const coef = -mat[j][i] / mat[i][i];
			for (let k = i; k < n + 1; k++) {
				if (i == k) {
					mat[j][k] = 0;
				} else {
					mat[j][k] += coef * mat[i][k];
				}
			}
		}
	}

	// Solve Ax=b for upper triangular matrix A (mat)
	const x = new Array(n);
	for (let l = n - 1; l >= 0; l--) {
		x[l] = mat[l][n] / mat[l][l];
		for (let m = l - 1; m >= 0; m--) {
			mat[m][n] -= mat[m][l] * x[l];
		}
	}
	return x;
}

app.listen(3000, () => {
  console.log(`Example app listening on port 3000`);
})
