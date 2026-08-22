package com.chessjust.app.ui.theme

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Background = Color(0xFF0B1016)
private val Surface = Color(0xFF151C25)
private val Surface2 = Color(0xFF1C2530)
private val Accent = Color(0xFF55A8D8)
private val Success = Color(0xFF63C18A)

private val DarkScheme = darkColorScheme(
    primary = Accent, secondary = Color(0xFF8BBBD6), tertiary = Color(0xFFD0A95C),
    background = Background, surface = Surface, surfaceVariant = Surface2,
    onBackground = Color(0xFFF3F6F9), onSurface = Color(0xFFF3F6F9)
)

@Composable fun ChessjustTheme(content: @Composable () -> Unit) { MaterialTheme(colorScheme = DarkScheme, content = content) }
