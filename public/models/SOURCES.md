# Model sources

All models here are CC0 (public domain). License verified on the source pages on 2026-10-31.

| File | Asset | Author | License | Source | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `quaternius-horse/Horse.glb` | Horse from the "Ultimate Animated Animals" pack (July 2021): rigged, 13 clips (Idle, Idle_2, Idle_Headlow, Walk, Gallop, Gallop_Jump, Jump_toIdle, Attack_Headbutt, Attack_Kick, Death, Eating, Idle_HitReact_Left/Right), 1,874 tris | Quaternius | CC0 1.0 | Downloaded from Poly Pizza, listing shows "Public Domain (CC0)" / licence "CC0 1.0", creator Quaternius: https://poly.pizza/m/qvTrSG9pZF (file `https://static.poly.pizza/d37dbc87-ca61-4b2c-a2da-d2f0c4240bef.glb`). Pack announcement, "Free for everyone to use in any project, even commercially! (CC0)": https://www.patreon.com/quaternius/posts/ultimate-animals-53427821. Quaternius site states all models use the CC0 License: https://quaternius.com/packs/ultimatedanimatedanimals.html | `fae7a7ec91e0d6a33554efb896fac9c4e8c632644183bcb8cc962f673d3ce609` |

The file is unmodified. Materials are replaced at runtime so the horse matches the other pieces:
body, mane and muzzle take the side's ivory/ebony lacquer, hooves take gold, eyes take ebony.
The horned-helm lancer riding it is our own geometry (`src/scene/rider.ts`), not from any asset.
It stands on the knight's procedural turned base (foot + gold rings from `src/scene/pieces.ts`).

The earlier Quaternius "Animated Knight Pack" (human knight, step 4b v1) was removed in favour of the horse.
