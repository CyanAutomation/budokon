# frozen_string_literal: true

require "yaml"

root = File.expand_path("..", __dir__)
document = YAML.safe_load_file(File.join(root, "openapi/v1.yaml"), aliases: false)

def assert_equal(actual, expected, context)
  return if actual == expected

  abort "#{context}: expected #{expected.inspect}, got #{actual.inspect}"
end

expected_responses = {
  ["/v1/judoka", "get"] => { "200" => "JudokaList", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/judoka/{id}", "get"] => { "200" => "Judoka", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/techniques", "get"] => { "200" => "TechniqueList", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/techniques/{id}", "get"] => { "200" => "Technique", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/events", "get"] => { "200" => "EventList", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/events/{id}", "get"] => { "200" => "Event", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/events/draw", "post"] => { "200" => "EventDraw", "429" => "RateLimited" },
  ["/v1/countries", "get"] => { "200" => "Countries", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/weight-categories", "get"] => { "200" => "WeightCategories", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/version", "get"] => { "200" => "Version", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/status", "get"] => { "200" => "Status", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/coverage", "get"] => { "200" => "Coverage", "304" => "NotModified", "429" => "RateLimited" },
  ["/v1/draw", "post"] => { "200" => "JudokaDraw", "429" => "RateLimited" }
}

expected_responses.each do |(path, method), responses|
  responses.each do |status, component|
    actual = document.dig("paths", path, method, "responses", status, "$ref")
    assert_equal(actual, "#/components/responses/#{component}", "#{method.upcase} #{path} response #{status}")
  end
end

visibility_operations = document.fetch("paths").flat_map do |path, path_item|
  path_item.filter_map do |method, operation|
    next unless operation.is_a?(Hash)
    next unless operation.fetch("parameters", []).any? { |parameter| parameter["$ref"] == "#/components/parameters/IncludeHidden" }

    [path, method]
  end
end
assert_equal(visibility_operations, [["/v1/judoka", "get"]], "operations using IncludeHidden")

responses = document.dig("components", "responses")
assert_equal(responses.dig("NotModified", "headers")&.keys || [], ["ETag"], "NotModified response headers")
assert_equal(
  responses.dig("RateLimited", "headers")&.keys&.sort || [],
  ["RateLimit-Limit", "RateLimit-Policy", "Retry-After"].sort,
  "RateLimited response headers"
)

response_schemas = {
  "Judoka" => "Judoka", "Technique" => "Technique", "Event" => "Event",
  "EventDraw" => "EventDraw", "Version" => "Version", "Status" => "Status",
  "Coverage" => "Coverage", "JudokaDraw" => "JudokaDraw"
}
response_schemas.each do |response, schema|
  actual = responses.dig(response, "content", "application/json", "schema", "$ref")
  assert_equal(actual, "#/components/schemas/#{schema}", "#{response} response body")
end

schemas = document.dig("components", "schemas")
assert_equal(schemas.dig("Judoka", "properties", "sources", "items", "$ref"), "#/components/schemas/Source", "Judoka sources")
assert_equal(schemas.dig("Judoka", "properties", "sourceUrls", "items", "format"), "uri", "Judoka sourceUrls")
