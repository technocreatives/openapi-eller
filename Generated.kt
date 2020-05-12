/**
* The following dependencies should be added to your build.gradle module file:
* 
* implementation "com.squareup.retrofit2:converter-gson:2.3.+"
* implementation "io.reactivex.rxjava2:rxandroid:2.1.+"
* implementation "com.squareup.retrofit2:adapter-rxjava2:2.3.+"
*
* If you use OpenID, you need to add 'maven { url 'https://jitpack.io' }',
* to allprojects.repositories to you build.gradle project file.
* You also need to add 'implementation 'com.github.lenguyenthanh:AppAuth-Android:ea77a09f3e''
* as a dependency to your build.gradle module file.
*/

@file:Suppress("MoveLambdaOutsideParentheses")

package com.weret.app.service.datasources.magicseaweed

// Generated. Do not edit.

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.google.gson.TypeAdapter
import com.google.gson.TypeAdapterFactory
import com.google.gson.annotations.SerializedName
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter
import io.reactivex.Completable
import io.reactivex.Single
import io.reactivex.android.schedulers.AndroidSchedulers
import io.reactivex.disposables.Disposables
import io.reactivex.subjects.PublishSubject
import net.openid.appauth.*
import okhttp3.*
import retrofit2.Retrofit
import retrofit2.adapter.rxjava2.RxJava2CallAdapterFactory
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*
import java.io.Serializable
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

@Target(AnnotationTarget.TYPE)
@MustBeDocumented
annotation class Format(val value: String)

interface JsonEnum {
    val value: String
}

sealed class MagicSeaWeedServer(private val urlPattern: String) {
    object Api: MagicSeaWeedServer("https://magicseaweed.com/api/")

    override fun toString(): String = this.urlPattern
}



private fun createGson(): Gson {
    fun createDateFormatter(pattern: String, tz: String): SimpleDateFormat {
        val df = SimpleDateFormat(pattern, Locale.ROOT)
        df.timeZone = TimeZone.getTimeZone(tz)
        return df
    }

    class EnumTypeAdapter<T>(private val type: T) : TypeAdapter<T>() where T: JsonEnum {
        override fun write(writer: JsonWriter, value: T) {
            writer.value(value.value)
        }

        override fun read(reader: JsonReader): T {
            val s = reader.nextString()
            return type::class.java.enumConstants?.first { it.value == s }
                ?: throw Exception("Invalid value: $s")
        }
    }

    class DateAdapter(format: String) : TypeAdapter<Date>() {
        private val formatter = when (format) {
            "date" -> createDateFormatter("yyyy-MM-dd", "UTC")
            "date-time" -> createDateFormatter("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "UTC")
            else -> createDateFormatter("yyyy-MM-dd'T'HH:mm:ss'Z'", "UTC")
        }

        override fun write(writer: JsonWriter, value: Date) {
            writer.value(formatter.format(value))
        }

        override fun read(reader: JsonReader): Date {
            return formatter.parse(reader.nextString())
        }
    }

    class DateAdapterFactory : TypeAdapterFactory {
        override fun <T> create(gson: Gson, type: TypeToken<T>): TypeAdapter<T>? {
            if (type.rawType != Date::class.java) {
                return null
            }

            val format = type.rawType.getAnnotation(Format::class.java)?.value ?: "date-time"
            @Suppress("UNCHECKED_CAST")
            return DateAdapter(format).nullSafe() as TypeAdapter<T>
        }
    }

    class EnumTypeAdapterFactory : TypeAdapterFactory {
        override fun <T> create(gson: Gson, type: TypeToken<T>): TypeAdapter<T>? {
            if (!type.rawType.isEnum || type.rawType.interfaces.contains(JsonEnum::class.java)) {
                return null
            }

            @Suppress("UNCHECKED_CAST")
            return EnumTypeAdapter(type.rawType as JsonEnum) as TypeAdapter<T>
        }
    }

    return GsonBuilder()
            .registerTypeAdapterFactory(EnumTypeAdapterFactory())
            .registerTypeAdapterFactory(DateAdapterFactory())
            .setDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'")
            .create()
}

interface MagicSeaWeedService {
    companion object {
        fun create(server: MagicSeaWeedServer, vararg interceptors: Interceptor) =
                 create(server.toString(), *interceptors)

        fun create(baseUrl: String, vararg interceptors: Interceptor): MagicSeaWeedService =
                Retrofit.Builder()
                        .client(interceptors.fold(OkHttpClient.Builder(), { acc, cur -> acc.addInterceptor(cur) }).build())
                        .baseUrl(baseUrl)
                        .addConverterFactory(GsonConverterFactory.create(createGson()))
                        .addCallAdapterFactory(RxJava2CallAdapterFactory.createAsync())
                        .build()
                        .create(MagicSeaWeedService::class.java)
    }

    @GET("{apikey}/forecast/")
    fun getForecastData(@Path("apikey") apikey: String,
        @Query("spot_id") spotId: Long,
        @Query("user") user: String): Single<List<ForecastResponse>>

    @GET("{apikey}/tide/")
    fun getTideData(@Path("apikey") apikey: String,
        @Query("spot_id") spotId: Long,
        @Query("user") user: String): Single<List<TideResponse>>

    @GET("{apikey}/spot/")
    fun getSpotsData(@Path("apikey") apikey: String,
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("distance") distance: Double,
        @Query("offset") offset: Long? = null,
        @Query("limit") limit: Long? = null,
        @Query("user") user: String): Single<List<SpotsResponse>>
}

data class TideResponse(
        val timestamp: Long?,
        val tide: List<Tide>?,
        val unit: String?,
        val sunriseTwillight: Long?,
        val sunrise: Long?,
        val sunsetTwillight: Long?,
        val images: Images?,
        val port: Port?
) : Serializable {
    data class Images(
            val full: String?
    ) : Serializable {
    }
    data class Port(
            val name: String?,
            val lat: Double?,
            val lon: Double?,
            val distance: Double?,
            val unit: String?
    ) : Serializable {
    }
}

data class ForecastResponse(
        val timestamp: @Format("integer") Double?,
        val localTimestamp: @Format("integer") Double?,
        val issueTimestamp: @Format("integer") Double?,
        val gfsIssueTimestamp: @Format("integer") Double?,
        val fadedRating: @Format("integer") Double?,
        val solidRating: @Format("integer") Double?,
        @SerializedName("en_threeHourTimeText")
        val enThreeHourTimeText: String?,
        val threeHourTimeText: String?,
        val timezoneAbbr: String?,
        val swell: Swell?,
        val wind: Wind?,
        val condition: Condition?
) : Serializable {
    data class Swell(
            val height: Double?,
            val absHeight: Double?,
            val absMinBreakingHeight: Double?,
            val absMaxBreakingHeight: Double?,
            val incomingSwellCount: @Format("integer") Double?,
            val direction: Double?,
            val trueDirection: Double?,
            val compassDirection: String?,
            val period: @Format("integer") Double?,
            val probability: Double?,
            val unit: String?,
            val minBreakingHeight: Double?,
            val maxBreakingHeight: Double?,
            val components: Components?
    ) : Serializable {
        data class Components(
                val combined: Combined?,
                val primary: Primary?
        ) : Serializable {
            data class Combined(
                    val height: Double?,
                    val absHeight: Double?,
                    val period: @Format("integer") Double?,
                    val windSeaFraction: Double?,
                    val power: Double?,
                    val direction: Double?,
                    val trueDirection: Double?,
                    val directionalSpread: Double?,
                    val compassDirection: String?,
                    val isOffshore: Boolean?
            ) : Serializable {
            }
            data class Primary(
                    val height: Double?,
                    val absHeight: Double?,
                    val period: @Format("integer") Double?,
                    val windSeaFraction: Double?,
                    val power: Double?,
                    val direction: Double?,
                    val trueDirection: Double?,
                    val directionalSpread: Double?,
                    val compassDirection: String?,
                    val isOffshore: Boolean?,
                    val absBreakingHeight: Double?
            ) : Serializable {
            }
        }
    }
    data class Wind(
            val speed: Double?,
            val direction: Double?,
            val trueDirection: Double?,
            val compassDirection: String?,
            val chill: Double?,
            val gusts: Double?,
            val unit: String?,
            val rating: Double?,
            val stringDirection: String?
    ) : Serializable {
    }
    data class Condition(
            val pressure: Double?,
            val temperature: Double?,
            val sst: Double?,
            val weather: String?,
            val weatherText: String?,
            val unitPressure: String?,
            val unit: String?
    ) : Serializable {
    }
}

data class SpotsResponse(
        @SerializedName("_id")
        val id: Long?,
        @SerializedName("_path")
        val path: String?,
        val name: String?,
        val description: String?,
        val lat: Double?,
        val lon: Double?,
        val surfAreaId: @Format("integer") Double?,
        val optimumSwellAngle: @Format("integer") Double?,
        val optimumWindAngle: @Format("integer") Double?,
        val isBigWave: Boolean?,
        val mapImageUrl: String?
) : Serializable {
}

data class Tide(
        val shift: Double?,
        val state: String?,
        val unixtime: Long?,
        val timestamp: Long?,
        val timezoneOffset: Long?
) : Serializable {
}

