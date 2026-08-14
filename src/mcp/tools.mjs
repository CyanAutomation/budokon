export function createMcpTools({ catalog, draw }) {
  return {
    get_judoka: ({ id, includeHidden }, context = {}) => catalog.getJudoka(id, { includeHidden, authorizedInternal: context.authorizedInternal }),
    search_judoka: ({ filters = {}, exclude = [], includeHidden } = {}, context = {}) => catalog.listJudoka({ filters, exclude, includeHidden, authorizedInternal: context.authorizedInternal }),
    draw_judoka: (input, context = {}) => draw.draw(input, context),
    list_techniques: () => catalog.listTechniques(), get_technique: ({ id }) => catalog.getTechnique(id)
  };
}
