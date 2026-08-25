// One discrete color in a map legend. Kept apart from color ramps: a ramp describes a numeric
// range belonging to a layer, while these describe named states whose colors come from a previewer's
// theme (an available index-map sheet, an unavailable one, and the selected sheet, for example).
export type LegendEntry = {
  label: string;
  color: string;
};
