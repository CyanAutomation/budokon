/** Interface for application access to a generated, immutable read model. */
export class ReadModelRepository {
  get datasetVersion() { throw new Error("not implemented"); }
  listJudoka() { throw new Error("not implemented"); }
  getJudoka(_id) { throw new Error("not implemented"); }
  listTechniques() { throw new Error("not implemented"); }
  getTechnique(_id) { throw new Error("not implemented"); }
  listCountries() { throw new Error("not implemented"); }
  listWeightCategories() { throw new Error("not implemented"); }
}
