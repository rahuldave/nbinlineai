---
title: Attach an image to an AI question
---

# Attach an image to an AI question

`attach_media(media, question_cell_id, detail="auto")` proposes one exact still image for one identified AI question. It accepts an owned memory result with a `media_id` or a saved-file reference with its server-root-relative `path` and SHA-256. A visible preview asks you to confirm the image and names the target question. Clicking **Attach image** records the image reference and hash on that question; it does not run the question or call a model. If that question already has an image, the confirmation explicitly says it will replace it. Cancel leaves the earlier attachment in place.

## Attach, inspect, then ask

First prepare an actual image result or saved file reference and identify the target AI question's stable cell ID. The [attachment walkthrough](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-call) prepares a small PNG with its real hash as `source_ref` and uses its question ID. After running that setup, call the tool in its own code cell:

```python
from nbinlineai.tools import attach_media
attached = attach_media(source_ref, question_cell_id="attachment-question")
```

Review the visible preview and click **Attach image** for the intended question. In a later code cell, check the same receipt before running the question:

```python
print(attached.status, attached.error)
assert attached.status == "completed", "Confirm the image, then rerun this cell."
print(attached.result)
```

The question now shows **Image attached**. Run it only when you want to send that image to the selected image-capable model. The [AI attachment question](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html#attachment-tool-ai-question) demonstrates a separate model-initiated attach request; its first reply is a snapshot, so it uses a later status check after confirmation.

## Confirmation and privacy details

The Python call returns a `BrowserReceipt` promptly. In a later cell, inspect `attached.status`, `attached.result`, and `attached.error`. A waiting receipt becomes `completed` after the visible confirmation, or `cancelled` or `failed` if you decline or the image is unavailable. To discover the target question's actual cell ID, offer `list_cells` to an AI question in the open notebook; it is a live-cell model tool, not a direct Python call. Do not use a displayed index in place of an ID. The [disposable notebook example](https://rahuldave.com/nbinlineai/notebooks/browser-media-attachment.html) creates a tiny PNG and its actual hash, demonstrates the labeled call and later receipt inspection, and removes the temporary file after the question.

After confirmation, that question shows **Image attached** and **Remove image**. Removing clears this question's attachment; it does not delete the saved file or original managed media. You can confirm a replacement image later. An unfinished or declined confirmation does not occupy a lasting attachment slot. Temporary attachments can expire when their media, browser tab, or kernel ends. At most four can be outstanding for one question and eight for the current browser session.

Only the confirmed question sends the image when you run it; an earlier question's attachment does not carry over. Context preview checks the selected model and file without attaching or running anything. A changed or missing saved file fails the later question rather than sending different pixels. An in-memory image expires with its media, tab, or kernel, so save it first if the question must work after reopening. The notebook keeps the exact saved path, hash, question ID, and detail for that confirmation, but neither image pixels nor browser credentials.

### Formats and model choices

PNG, JPEG, WebP, and single-frame GIF are supported, within the existing 4,096-pixel side and 16-megapixel still-image limits. SVG, audio, animated GIF and full video are refused for model input. Capturing or previewing media alone never sends it to a model. The offered OpenAI API and Anthropic API models use genuine native image content. OpenAI API accepts `auto`, `low`, or `high` detail; Anthropic accepts `auto` only because its native image part has no equivalent generic detail setting. The ChatGPT subscription connection uses a private native local-image item and accepts all three detail choices. An unknown or text-only model fails with `provider_unsupported`; select a supported model explicitly. If the exact image plus question and tool schemas exceed the submission budget, create and confirm an explicit smaller derivative. The extension never resizes an accepted image behind your back.

The ordinary preparation and confirmation steps do not send a model request. Running the attached AI question uses your selected connection and its normal usage terms. Review the image and question before confirming; remove the attachment if you change your mind.
