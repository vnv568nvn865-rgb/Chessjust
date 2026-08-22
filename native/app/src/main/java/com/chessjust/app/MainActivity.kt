package com.chessjust.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.chessjust.app.ui.theme.ChessjustTheme

private enum class Section { HOME, TRAINING, PLAY, PROFILE }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); setContent { ChessjustTheme { ChessjustApp() } } }
}

@Composable private fun ChessjustApp() {
    var section by rememberSaveable { mutableStateOf(Section.HOME) }
    Scaffold(bottomBar = { NavigationBar { listOf(
        Section.HOME to "الرئيسية", Section.TRAINING to "التدريب", Section.PLAY to "اللعب", Section.PROFILE to "حسابي"
    ).forEach { (s,label) -> NavigationBarItem(selected=s==section,onClick={section=s},icon={Text(when(s){Section.HOME->"⌂";Section.TRAINING->"♞";Section.PLAY->"♟";Section.PROFILE->"●"})},label={Text(label)}) } } }) { pad ->
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(pad).padding(horizontal=16.dp,vertical=12.dp)) {
            when(section) { Section.HOME -> HomeScreen(); Section.TRAINING -> TrainingScreen(); Section.PLAY -> Placeholder("اللعب"); Section.PROFILE -> Placeholder("حسابي") }
        }
    }
}

@Composable private fun HomeScreen() {
    Text("Chessjust", fontSize=28.sp, color=MaterialTheme.colorScheme.onBackground)
    Spacer(Modifier.height(18.dp))
    FeatureCard("العب ضد المحرك", "مباراة جديدة", Modifier.fillMaxWidth())
    Spacer(Modifier.height(12.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        FeatureCard("التكتيكات", "تدريب", Modifier.weight(1f)); FeatureCard("الألغاز", "2500+", Modifier.weight(1f))
    }
    Spacer(Modifier.height(10.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(10.dp)) {
        FeatureCard("الافتتاحيات", "أكاديمية", Modifier.weight(1f)); FeatureCard("المدرب", "تحليل", Modifier.weight(1f))
    }
    Spacer(Modifier.height(18.dp)); Text("تقدمك", color=MaterialTheme.colorScheme.onSurface, fontSize=18.sp)
    Spacer(Modifier.height(8.dp)); LinearProgressIndicator(progress={0.18f}, Modifier.fillMaxWidth())
}

@Composable private fun TrainingScreen() { Text("التدريب", fontSize=26.sp); Spacer(Modifier.height(14.dp)); FeatureCard("التكتيكات", "مراحل متعددة النقلات", Modifier.fillMaxWidth()); Spacer(Modifier.height(10.dp)); FeatureCard("الألغاز", "مواقف صعبة", Modifier.fillMaxWidth()); Spacer(Modifier.height(10.dp)); FeatureCard("الافتتاحيات", "افتتاحيات وتفريعات", Modifier.fillMaxWidth()) }
@Composable private fun Placeholder(title:String) { Text(title, fontSize=26.sp); Spacer(Modifier.height(12.dp)); Text("سيتم بناء هذه الشاشة داخل الواجهة الأصلية في المرحلة التالية.", color=MaterialTheme.colorScheme.onSurfaceVariant) }
@Composable private fun FeatureCard(title:String, subtitle:String, modifier:Modifier) { Card(modifier, shape=RoundedCornerShape(18.dp), colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface)) { Column(Modifier.padding(18.dp)) { Text(title,fontSize=18.sp); Spacer(Modifier.height(4.dp)); Text(subtitle,color=MaterialTheme.colorScheme.onSurfaceVariant,fontSize=13.sp) } } }
