---
title: Attach an image to an AI question
---

# Attach an image to an AI question

Use `attach_media(media, question_cell_id, detail="auto")` to propose one exact image for one AI question. You see the image and the target question ID before you click **Attach image**. Confirmation adds a reference to that question; it does not run the question or send pixels to a model. You decide when to run it.

The [worked attachment notebook](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html) has two ways to make the request: a direct Python call and an AI question that calls the tool. It generates a disposable blue PNG locally, computes the file's actual SHA-256, and names its target AI question `attachment-question`. Its saved AI trace shows a completed confirmation and hash; the target image question is left for you to run. Use a disposable notebook with a live kernel and a configured image-capable connection.

## Call it from Python

Run the notebook's [image setup cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-setup) first. It creates `source_ref = {"path": ..., "sha256": ...}` from the bytes it just wrote. Then run its [direct call](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-call):

```python
from nbinlineai.tools import attach_media
attached = attach_media(source_ref, question_cell_id="attachment-question")
attached
```

The call returns a `BrowserReceipt` promptly, usually with `waiting_for_user`. Check the preview and question ID, then click **Attach image**. Inspect the *same* receipt in a [later cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-inspect), rerunning that cell after confirmation if needed:

```python
attached.status, attached.operation_id, attached.result, attached.error
```

Successful `attached.result` includes `confirmed`, `question_cell_id`, `image_sha256`, and `detail`. Expect `completed` only after confirmation; cancellation or failure reports a different status and leaves any previous attachment in place. If you attach another image to the same question, the dialog says it will replace the current one. A notebook without a known target ID can discover live cell IDs with the AI tool `list_cells`; a displayed cell number is not a stable ID.

## Ask the AI to call it

The notebook's [AI tool question](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-tool-ai-question) declares `` &`attach_media` `` and passes the live Python value as `` $`source_ref` `` to target `attachment-question`. The first answer reports the operation ID and `waiting_for_user`; it cannot claim that you confirmed the image. Click **Attach image**, then use the [follow-up AI question](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-tool-ai-ready), which calls `operation_status` on that ID. The saved trace shows `completed` with the actual question ID and SHA-256. These AI questions demonstrate the tool and receipt; they do not run the target image question. If you also run the direct Python call, it asks for a separate confirmation of that same image and replaces the earlier attachment.

## Run, remove, or keep the image

After confirmation, the [target question](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-question) shows **Image attached** and **Remove image**. You can preview its context to check the selected model and attachment without sending it. The pixels reach the selected provider only when you run that *identified* AI question. An attachment on an earlier question is not inherited by later questions. The model receives the image as a native image input, rather than as image bytes in tool text.

**Remove image** clears the question's reference; it does not delete the original media or saved file. The notebook's [cleanup cell](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-cleanup) deletes its disposable PNG after you finish. Deleting it earlier makes a later preview or run fail. A saved-file reference is a server-root-relative `path` plus the SHA-256 of those exact bytes; the file is read and hash-checked again when the question runs. Changed or missing bytes fail instead of sending a different image. An in-memory reference uses an owned `media_id` and can expire when the media, browser tab, or kernel ends; save it first if you need to reopen the notebook. The notebook stores the question ID, hash, detail, and saved path or temporary grant, without storing image pixels or browser credentials.

PNG, JPEG, WebP, and single-frame GIF are accepted up to 4,096 pixels on either side and 16 megapixels. SVG, audio, animated GIF, and full video are not image inputs. The offered OpenAI API, Anthropic API, and ChatGPT subscription image-capable models have native image transport. Use `detail="auto"` for Anthropic; `low` and `high` require an explicit OpenAI API or ChatGPT question choice. An unknown or text-only model reports `provider_unsupported`. If the exact image makes the submission too large, prepare and confirm a smaller image yourself; attachment does not silently resize it.
