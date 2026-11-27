# CHAMBER

Localhost media streaming in the browser. Files in `media/` are listed and streamed with HTTP range requests so seeking works.

## Run

```bash
cd stream
npm start
```

Open **http://127.0.0.1:8765**

- **Play sample** starts a built-in demo clip
- **Add video** (or drag-and-drop) copies a file into `media/` and plays it
- Put `.mp4`, `.webm`, `.mov`, `.mkv`, or `.m4v` files in `media/` yourself

Optional env:

| Variable | Default     | Meaning              |
| -------- | ----------- | -------------------- |
| `PORT`   | `8765`      | Listen port          |
| `HOST`   | `127.0.0.1` | Bind address         |

Bind `HOST=0.0.0.0` only on a trusted LAN if you want other devices to reach it.
