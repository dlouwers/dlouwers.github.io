---
layout: post
title: Peace of mind in a state of overload
date: '2015-01-18T18:21:00.000+02:00'
author: Dirk Louwers
tags:
- scala
modified_time: '2015-01-18T18:21:00.000+02:00'
---
# Try is free in the Future
Lately I have seen a few developers consistently use a Try inside of a Future in
order to make error handling easier. Here I will investigate if this has any
merits or whether a Future on it's own offers enough error handle.

If you look at the following code there is nothing that a `Future` can't supply
but a `Try` can.

{% highlight scala %}
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future}
import scala.concurrent.duration._

object Main extends App {

  // Happy Future
  val happyFuture = Future {
    42
  }

  // Bleak future
  val bleakFuture = Future {
    throw new Exception("Mass extinction!")
  }

  // We would want to wrap the result into a hypothetical http response
  case class Response(code: Int, body: Array[Byte])

  object Response {
    def fromInt(int: Int): Response = {
      val buffer = java.nio.ByteBuffer.allocate(4)
      buffer.putInt(int)
      Response(200, buffer.array())
    }
  }

  // This is the handler we will use
  def handle[T](future: Future[T]): Future[Response] = {
    future.map {
      case answer: Int => Response.fromInt(answer)
    } recover {
      case t: Throwable => Response(500, Array.empty[Byte])
    }
  }

  {
    val result = Await.result(handle(happyFuture), 1 second)
    assert(result.code == 200)
    val buffer = java.nio.ByteBuffer.wrap(result.body)
    assert(buffer.getInt == 42)
  }

  {
    val result = Await.result(handle(bleakFuture), 1 second)
    assert(result.code == 500)
  }
}

{% endhighlight %}
