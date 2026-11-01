# Model sources

Third-party models here are CC0 (public domain), license verified on the source pages on 2026-10-31.
The pawn model was provided by the user; its license is PENDING the user's confirmation (see below).

| File | Asset | Author | License | Source | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `quaternius-horse/Horse.glb` | Horse from the "Ultimate Animated Animals" pack (July 2021): rigged, 13 clips (Idle, Idle_2, Idle_Headlow, Walk, Gallop, Gallop_Jump, Jump_toIdle, Attack_Headbutt, Attack_Kick, Death, Eating, Idle_HitReact_Left/Right), 1,874 tris | Quaternius | CC0 1.0 | Downloaded from Poly Pizza, listing shows "Public Domain (CC0)" / licence "CC0 1.0", creator Quaternius: https://poly.pizza/m/qvTrSG9pZF (file `https://static.poly.pizza/d37dbc87-ca61-4b2c-a2da-d2f0c4240bef.glb`). Pack announcement, "Free for everyone to use in any project, even commercially! (CC0)": https://www.patreon.com/quaternius/posts/ultimate-animals-53427821. Quaternius site states all models use the CC0 License: https://quaternius.com/packs/ultimatedanimatedanimals.html | `fae7a7ec91e0d6a33554efb896fac9c4e8c632644183bcb8cc962f673d3ce609` |
| `pawn/Pawn.glb` | Spear-carrying pawn soldier: rigged (Hips…Hands), 4 clips (idle 1.4 s, move 0.8 s, attack 1.0 s, hit 0.84 s), ~19,976 tris, detachable spear on the right hand, 1 embedded 1024 JPEG texture. GLB generator string: "Original procedural chess pawn (Python + trimesh + NumPy)" | Provided by the user (2026-11-01) | **PENDING user confirmation** | Provided by user in chat. The file's own `extras.license_note` says "Original procedural geometry, no Mixamo or third-party meshes used. Use permitted subject to applicable OpenAI terms." Not yet confirmed as a license for this project. | `e991c89b344e3e1bdec8038e1ab1e30cc6b10460cd03c9d081c2c335919919a9` |

Horse: the file is unmodified. Materials are replaced at runtime so the horse matches the other pieces:
body, mane and muzzle take the side's ivory/ebony lacquer, hooves take gold, eyes take ebony.
The horned-helm lancer riding it is our own geometry (`src/scene/rider.ts`), not from any asset.
`src/scene/rider.ts` is original code written for this project; it uses no external model, texture or other asset.
It stands on the knight's procedural turned base (foot + gold rings from `src/scene/pieces.ts`).

The earlier Quaternius "Animated Knight Pack" (human knight, step 4b v1) was removed in favour of the horse.

Pawn: the file is unmodified (no re-export). At runtime (`src/scene/figure.ts`):
- materials are replaced: armour, cloth, skin, leather, steel take the side's ivory/ebony lacquer,
  GOLD stays gold, EYES and SHADOW take ebony (the embedded texture is loaded but unused);
- the idle clip holds the arms out in a T-pose, so a lowered-arm rest pose is layered onto every clip
  (the spear stays upright in the right hand, and tips forward for the thrust);
- 16 zero-length normals in the cloth are pointed up (they rendered as NaN and blacked out the bloomed frame);
- it is scaled to 0.5 high with its boot soles (y ≈ 0 in the file; the armour alone ends 0.066 up)
  on a low procedural pedestal from `src/scene/pieces.ts`.
