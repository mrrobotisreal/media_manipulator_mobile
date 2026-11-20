# Caption ASS goldens (MM121)

Byte-for-byte copies of `media_manipulator_api/internal/services/testdata/captions/` (one
`(cues, style, canvas)` input per `.json`, the exact generator output per `.ass`). Both
generators must reproduce every `.ass`: Go `services.BuildASS` and TS `lib/studio/captions/ass.ts`
(`ass.test.ts`, which also checks these copies against the API when it sits next to this repo).

After an intentional generator change, change both generators, then:

```sh
cd media_manipulator_api && UPDATE_CAPTION_GOLDENS=1 go test ./internal/services -run 'TestCaptionASSGoldens|TestCaptionCatalogFixture'
cp internal/services/testdata/captions/* ../media-manipulator-ui/lib/studio/captions/goldens/
cp internal/services/testdata/captions_catalog.json ../media-manipulator-ui/lib/studio/captions/captionsCatalog.json
```
