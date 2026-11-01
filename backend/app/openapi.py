"""Write the OpenAPI document; the frontend's API types are generated from it."""

import json
import sys

from app.main import app

with open(sys.argv[1], "w") as out:
    json.dump(app.openapi(), out, indent=2, sort_keys=True)
    out.write("\n")
