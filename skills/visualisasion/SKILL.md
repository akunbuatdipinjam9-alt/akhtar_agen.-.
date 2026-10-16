# Visualisasion
> Create clear, accurate local data visualizations with Chart.js whenever a chart materially improves the answer.

Use this skill when numeric or categorical information would be easier to understand visually: trends over time, comparisons, rankings, proportions, distributions, or relationships between variables.

## Core rule
Prefer `chart.create` for data visualization. Do NOT call `image.generate` merely to draw a graph, chart, dashboard-style plot, or other visualization of structured data. Chart.js is local, precise, interactive, and does not spend image-generation quota.

## Decide whether a chart is useful
- Use a line chart for ordered trends and time series.
- Use a bar chart for category comparisons and rankings.
- Use pie/doughnut only for a small number of parts of one meaningful whole.
- Use scatter for relationships between numeric variables.
- If a small table or a sentence is clearer than a chart, do not create a chart just for decoration.

## Data integrity
Never invent measurements. Use user-provided data, tool results, or values you can calculate reliably. Preserve units and meaningful labels. If data is incomplete, say so instead of fabricating missing points.

## Workflow
1. Understand the data and the question the user is trying to answer.
2. Choose the simplest appropriate chart type.
3. Call `chart.create` with clean labels and datasets.
4. Keep titles and dataset labels concise.
5. Use `chart.update` when revising an existing chart instead of creating duplicates.
6. Verify that the returned artifact exists before saying it is complete.

The chart tool accepts data/configuration only. Never attempt to inject JavaScript, HTML, plugins, callbacks, or executable code into Chart.js options.
