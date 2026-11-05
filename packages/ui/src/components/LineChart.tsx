import { useId, type ComponentPropsWithRef } from "react";
import { cx } from "../cx.ts";
import { skinnable } from "../skin.tsx";

export interface LineChartSeries {
  key: string;
  label: string;
}

export interface LineChartDatum {
  /** Displayed verbatim, so calendar dates do not shift with the viewer's timezone. */
  label: string;
  /** Null means unavailable, not zero; it breaks the plotted line. */
  values: Record<string, number | null>;
}

export interface LineChartProps extends Omit<ComponentPropsWithRef<"figure">, "children"> {
  label: string;
  series: readonly LineChartSeries[];
  data: readonly LineChartDatum[];
  axisLabel: string;
}

/** Aligned small multiples share a count scale, keeping coincident and all-zero series visible. */
function LineChartBase({ label, series, data, axisLabel, className, ...rest }: LineChartProps) {
  const id = useId();
  let maximum = 0;
  for (const datum of data) {
    for (const item of series) maximum = Math.max(maximum, datum.values[item.key] ?? 0);
  }
  const ceiling = Math.max(1, maximum);
  const x = (index: number) => data.length > 1 ? index * 1000 / (data.length - 1) : 500;
  const y = (value: number) => 112 - value / ceiling * 104;
  const first = data[0]?.label;
  const last = data[data.length - 1]?.label;
  return (
    <figure className={cx("ui-line-chart", className)} aria-label={label} {...rest}>
      <figcaption className="ui-line-chart-caption">{axisLabel} · shared scale: 0–{ceiling.toLocaleString()}</figcaption>
      <ul className="ui-line-chart-series" aria-label="Chart series">
        {series.map((item, seriesIndex) => {
          let path = "";
          let connected = false;
          for (let index = 0; index < data.length; index++) {
            const value = data[index]!.values[item.key];
            if (value == null) {
              connected = false;
            } else {
              path += `${connected ? "L" : "M"}${x(index)},${y(value)} `;
              connected = true;
            }
          }
          const titleId = `${id}-${item.key}`;
          return (
            <li key={item.key} data-series={item.key} data-color={seriesIndex % 5}>
              <div className="ui-line-chart-legend" id={titleId}>
                <span className="ui-line-chart-swatch" aria-hidden="true" />{item.label}
              </div>
              <svg className="ui-line-chart-plot" data-testid="line-chart-plot" viewBox="0 0 1000 120" preserveAspectRatio="none" role="img" aria-labelledby={titleId}>
                <title>{item.label}: {first} – {last}</title>
                <desc>Counts from 0 to {ceiling}. Gaps indicate unavailable data. Exact values are in View daily data below.</desc>
                <path className="ui-line-chart-grid" d="M0,8 H1000 M0,60 H1000 M0,112 H1000" />
                <path className="ui-line-chart-line" d={path} vectorEffect="non-scaling-stroke" />
                {data.map((datum, index) => {
                  const value = datum.values[item.key];
                  return value == null ? null : (
                    <line key={datum.label} className="ui-line-chart-point" x1={x(index)} x2={x(index)} y1={y(value)} y2={y(value)}
                      vectorEffect="non-scaling-stroke" data-date={datum.label} data-value={value}>
                      <title>{datum.label}: {value.toLocaleString()}</title>
                    </line>
                  );
                })}
              </svg>
            </li>
          );
        })}
      </ul>
      <div className="ui-line-chart-axis" aria-label={axisLabel}><span>{first}</span><span>{last}</span></div>
      <details className="ui-line-chart-details">
        <summary data-testid="line-chart-values">View daily data</summary>
        <ol className="ui-line-chart-data">
          {data.map((datum) => (
            <li key={datum.label} data-date={datum.label}>
              <strong>{datum.label}</strong>
              <dl>{series.map((item) => (
                <div key={item.key}><dt>{item.label}</dt><dd data-series={item.key}>{datum.values[item.key] == null ? "Not tracked" : datum.values[item.key]!.toLocaleString()}</dd></div>
              ))}</dl>
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

export const LineChart = skinnable("LineChart", LineChartBase);
