package vn.minhsatori.app

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobService
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.CookieManager
import org.json.JSONObject
import java.net.URL
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/**
 * New customer alerts. The server checks the Google owner session.
 * Only hashed account/revision identifiers (never customer PII or cookies) are
 * kept locally. In-app polling is immediate; OS background jobs are ~15min.
 */
object V2RegistrationAlerts {
 const val ORIGIN="https://minh-satori-v2-customer-admin.onrender.com"
 private const val CHANNEL="satori_owner_registrations"
 private const val JOB=52029
 private const val PREF="satori_v2_registration_alerts"
 data class Feed(val pendingCount:Int,val items:List<Pair<String,String>>)

 fun createChannel(context:Context){
  val mgr=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  val channel=NotificationChannel(CHANNEL,"Minh Satori · Khách đăng ký mới",
   NotificationManager.IMPORTANCE_HIGH).apply {
   description="Báo khi có khách Google mới chờ Admin duyệt"
   enableVibration(true)
   setShowBadge(true)
   setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI,
    android.media.AudioAttributes.Builder()
     .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION).build())
  }
  mgr.createNotificationChannel(channel)
 }
 fun schedule(context:Context){
  createChannel(context)
  val scheduler=context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
  val info=JobInfo.Builder(JOB,ComponentName(context,V2RegistrationAlertJob::class.java))
   .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
   .setPeriodic(15*60*1000L)
   .build()
  scheduler.schedule(info)
 }
 fun cookie():String=try{
  CookieManager.getInstance().getCookie(ORIGIN).orEmpty()
 }catch(_:Exception){""}

 fun fetch(cookie:String):Feed?{
  if(!cookie.contains("satori_v2_session="))return null
  val c=(URL(ORIGIN+"/api/v2/admin/notifications").openConnection() as HttpsURLConnection).apply{
   connectTimeout=9000;readTimeout=9000
   instanceFollowRedirects=false;requestMethod="GET"
   setRequestProperty("Accept","application/json")
   setRequestProperty("Cache-Control","no-store")
   setRequestProperty("Cookie",cookie)
  }
  try{
   if(c.responseCode!=200)return null
   val body=c.inputStream.bufferedReader(Charsets.UTF_8).use{it.readText()}
   val json=JSONObject(body)
   if(!json.optBoolean("ok"))return null
   val count=json.optInt("pendingCount",-1)
   if(count<0)return null
   val list=json.optJSONArray("newest")
   val items=ArrayList<Pair<String,String>>()
   if(list!=null)for(i in 0 until list.length().coerceAtMost(100)){
    val item=list.optJSONObject(i)?:continue
    val id=item.optString("id","")
    val revision=item.optInt("revision",0)
    if(id.isBlank()||revision<1)continue
    val digest=java.security.MessageDigest.getInstance("SHA-256")
     .digest(id.toByteArray(Charsets.UTF_8))
     .joinToString(""){"%02x".format(it)}
    items.add(digest to item.optString("fullName","Khách mới").take(80))
   }
   return Feed(count,items)
  }finally{c.disconnect()}
 }

 fun pendingCount(context:Context):Int =
  context.getSharedPreferences(PREF,Context.MODE_PRIVATE).getInt("pending_count",0)

 fun process(context:Context,feed:Feed):Int{
  val prefs=context.getSharedPreferences(PREF,Context.MODE_PRIVATE)
  val previous=prefs.getStringSet("seen_hashes",emptySet())?.toSet().orEmpty()
  val initialized=prefs.getBoolean("initialized",false)
  val fresh=if(initialized)feed.items.filter{it.first !in previous}else emptyList()
  val latest=(previous+feed.items.map{it.first}).toList().takeLast(250).toSet()
  prefs.edit().putStringSet("seen_hashes",latest).putBoolean("initialized",true)
   .putInt("pending_count",feed.pendingCount).apply()
  if(fresh.isNotEmpty())notify(context,feed.pendingCount,fresh[0].second)
  return feed.pendingCount
 }

 private fun notify(context:Context,count:Int,name:String){
  if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(
   Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return
  createChannel(context)
  val mgr=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  val intent=Intent(context,V2OwnerCrmActivity::class.java).apply{
   flags=Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
  }
  val pending=PendingIntent.getActivity(context,JOB,intent,
   PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val notification=Notification.Builder(context,CHANNEL)
   .setSmallIcon(R.drawable.ic_satori_bell)
   .setContentTitle("Minh Satori · Có khách mới đăng ký")
   .setContentText(name+" · "+count+" hồ sơ chờ duyệt")
   .setNumber(count).setContentIntent(pending).setAutoCancel(true)
   .setCategory(Notification.CATEGORY_STATUS)
   .setVisibility(Notification.VISIBILITY_PRIVATE).build()
  mgr.notify(JOB,notification)
 }
}

/** OS-scheduled poll. True instant background push would require FCM. */
class V2RegistrationAlertJob:JobService(){
 private var executor:java.util.concurrent.ExecutorService?=null
 override fun onStartJob(params:JobParameters):Boolean{
  val cookie=V2RegistrationAlerts.cookie() // main thread: WebView CookieManager
  val current=Executors.newSingleThreadExecutor()
  executor=current
  current.execute{
   try{
    val feed=V2RegistrationAlerts.fetch(cookie)
    if(feed!=null)V2RegistrationAlerts.process(applicationContext,feed)
   }catch(_:Exception){}finally{jobFinished(params,false)}
  }
  return true
 }
 override fun onStopJob(params:JobParameters):Boolean{
  executor?.shutdownNow()
  executor=null
  return false
 }
}
