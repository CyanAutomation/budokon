export function createMcpTools({ catalog, draw }) {
  const versioned = body => ({ datasetVersion: catalog.repository.datasetVersion, ...body });
  return {
    get_judoka: ({ id, includeHidden }, context = {}) => versioned({ judoka: catalog.getJudoka(id, { includeHidden, authorizedInternal: context.authorizedInternal }) ?? null }),
    search_judoka: ({ query, q, filters = {}, exclude = [], collection, includeHidden } = {}, context = {}) => versioned({ judoka: catalog.searchJudoka({ query: query ?? q, filters, exclude, collection, includeHidden, authorizedInternal: context.authorizedInternal }) }),
    draw_judoka: (input, context = {}) => draw.draw(input, context),
    list_techniques: () => versioned({ techniques: catalog.listTechniques() }),
    get_technique: ({ id }) => versioned({ technique: catalog.getTechnique(id) ?? null }),
    version: () => catalog.version(),
  };
}
