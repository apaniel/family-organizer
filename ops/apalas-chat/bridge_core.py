"""Pure validation and prompt helpers for the private Apalas chat bridge."""
from pathlib import Path

MAX_FILE_BYTES = 25 * 1024 * 1024
SAFE_MIME_TYPES = {
    'application/pdf', 'application/json', 'application/rtf', 'application/zip',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
DANGEROUS_EXTENSIONS = {'.exe', '.dll', '.msi', '.bat', '.cmd', '.com', '.scr', '.js', '.jar', '.sh', '.ps1'}


def submission_action(mode: str, has_pending: bool) -> str:
    """Choose start, queue, or steer without silently changing a plain send."""
    if mode not in {'send', 'queue', 'steer'}:
        mode = 'send'
    if mode == 'send':
        if has_pending:
            raise ValueError('Espera a que termine la respuesta anterior')
        return 'start'
    if not has_pending:
        return 'start'
    return mode


def attachment_allowed(filename: str, mime: str, size: int) -> bool:
    suffix = Path(filename or '').suffix.lower()
    if size < 1 or size > MAX_FILE_BYTES or suffix in DANGEROUS_EXTENSIONS:
        return False
    return mime.startswith(('image/', 'audio/', 'video/', 'text/')) or mime in SAFE_MIME_TYPES


def compose_input(text: str, attachments: list[dict]) -> str:
    if not attachments:
        return text.strip()
    lines = [text.strip(), '', 'Archivos adjuntos privados disponibles en este equipo:']
    for item in attachments:
        lines.append(f"- {item['filename']} ({item['mime']}): {item['path']}")
    lines.extend(['', 'Usa las herramientas adecuadas para leer, ver, transcribir o analizar estos archivos antes de responder.'])
    return '\n'.join(lines).strip()
