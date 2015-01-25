---
layout: post
title: Try is free in the Future
date: '2015-01-18T18:21:00.000+02:00'
tags:
- scala
modified_time: '2015-01-18T18:21:00.000+02:00'
---
Lately I have seen a few developers consistently use a Try inside of a Future in
order to make error handling easier. Here I will investigate if this has any
merits or whether a Future on it's own offers enough error handle.

If you look at the following code there is nothing that a Future can't supply
but a Try can:

{% highlight scala %}
import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.{Await, Future, Awaitable}
import scala.concurrent.duration._
import scala.util.{Try, Success, Failure}

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
  case class Response(code: Int, body: String)

  // This is the handler we will use
  def handle[T](future: Future[T]): Future[Response] = {
    future.map {
      case answer: Int => Response(200, answer.toString)
    } recover {
      case t: Throwable => Response(500, "Uh oh!")
    }
  }

  {
    val result = Await.result(handle(happyFuture), 1 second)
    println(result)
  }

  {
    val result = Await.result(handle(bleakFuture), 1 second)
    println(result)
  }
}
{% endhighlight %}

After giving it some thought the only situation where I could imagine Try
being useful in conjunction with Future is when awaiting a Future but not wanting
to deal with error situations yet. The times I would be awaiting a future are
very few in practice though. But when needed something like this migth do:

{% highlight scala %}
object TryAwait {
  def ready[T](awaitable: Awaitable[T], atMost: Duration): Try[T] = {
    Try {
      Await.result(awaitable, atMost)
    }
  }
}
{% endhighlight %}

If you do feel that using Trys inside of Futures adds value to your codebase
please let me know.
