# Documentation follow-ups

- Explore an opt-in way to publish executed example notebooks. Quarto's current site build must continue to render saved `.ipynb` content without executing any cells, especially AI prompts. A future prototype could run a disposable copy in an isolated JupyterLab through nbinlineai's native Run All path, which respects AI cells and Keep answer behavior. Define deterministic provider data, tool-effect boundaries, output review, cost limits, and CI isolation before trying this.
- If public examples begin to include saved AI answers, check that the Quarto notebook filter styles their `isOutputCell` metadata as green response panels and that no private response content enters the published site.
